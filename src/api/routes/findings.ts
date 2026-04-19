/**
 * findings.ts — Platform-level findings API
 *
 * Findings are a platform primitive: they represent concrete gaps, deficiencies,
 * or problems regardless of whether they originated from assessments, signals,
 * vendor reviews, or manual entry.
 *
 * All routes are org-scoped and use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateFindingCreate } from "../lib/findingValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { dispatchWebhookEvent } from "../lib/webhookDispatcher.js";
import { triggerFindingAlert } from "../lib/findingAlertTrigger.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_STATUSES = new Set(["open", "in_progress", "closed", "accepted"]);
const VALID_SEVERITIES = new Set(["Critical", "High", "Moderate", "Low"]);
const VALID_SOURCE_TYPES = new Set([
  "assessment",
  "control_test",
  "vendor_review",
  "ai_review",
  "ai_governance_review",
  "obligation_review",
  "dependency_review",
  "signal",
  "manual",
  "risk"
]);
const VALID_PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);
const VALID_PATCH_STATUSES = new Set(["open", "in_progress", "closed", "accepted"]);

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/* =========================================================
   POST /api/findings
   Create a new finding for the requesting organization.
   When source_type='risk', source_id must belong to the org.
   ========================================================= */

router.post(
  "/findings",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const validation = validateFindingCreate(req.body);
      if ("error" in validation) {
        res.status(400).json(validation);
        return;
      }

      const {
        title,
        severity,
        source_type,
        description,
        source_id,
        domain,
        priority,
        likelihood,
        confidence,
        time_sensitivity,
        scoring_rationale,
        due_date
      } = validation.input;

      const owner_user_id = validation.input.owner_user_id ?? (req as any).autoUserId ?? null;

      // When source_type='risk', verify the risk belongs to this org
      if (source_type === "risk" && source_id !== null) {
        const riskCheck = await pg.query(
          `SELECT id FROM risks WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [source_id, organizationId]
        );
        if ((riskCheck.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "source_risk_not_found" });
          return;
        }
      }

      const result = await pg.query(
        `
        INSERT INTO findings (
          organization_id,
          title,
          severity,
          source_type,
          description,
          source_id,
          domain,
          priority,
          likelihood,
          confidence,
          time_sensitivity,
          scoring_rationale,
          owner_user_id,
          due_date,
          status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'open'
        )
        RETURNING
          id, organization_id, source_type, source_id, title, severity,
          description, domain, priority, likelihood, confidence,
          time_sensitivity, scoring_rationale, owner_user_id, due_date,
          status, created_at, updated_at
        `,
        [
          organizationId,
          title,
          severity,
          source_type,
          description,
          source_id,
          domain,
          priority,
          likelihood,
          confidence,
          time_sensitivity,
          scoring_rationale,
          owner_user_id,
          due_date
        ]
      );

      logger.info(
        { event: "finding_created", findingId: result.rows[0].id, organizationId },
        "Finding created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: req.userId ?? null,
        eventType: "finding.created",
        resourceType: "finding",
        resourceId: result.rows[0].id as string,
        payload: { severity, source_type: source_type ?? null },
        ipAddress: req.ip ?? null
      });

      triggerFindingAlert({
        findingId: result.rows[0].id as string,
        organizationId,
        title: title as string,
        severity: severity as string,
        domain: (domain as string | null) ?? null,
      });

      dispatchWebhookEvent({
        event_type: "finding.created",
        organization_id: organizationId,
        data: {
          id: result.rows[0].id,
          title: result.rows[0].title,
          severity: result.rows[0].severity,
          status: result.rows[0].status,
          source_type: result.rows[0].source_type,
          created_at: result.rows[0].created_at,
        },
      }).catch(() => {});

      res.status(201).json({ finding: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "finding_create_failed", err },
        "POST /api/findings failed"
      );
      res.status(500).json({ error: "finding_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/findings
   List findings for the requesting organization.
   Supports cursor pagination and filtering.
   ========================================================= */

router.get(
  "/findings",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const limit = parseLimit(req.query.limit);
      const beforeCreatedAt =
        isNonEmptyString(req.query.before_created_at)
          ? req.query.before_created_at
          : null;
      const beforeId =
        isNonEmptyString(req.query.before_id) ? req.query.before_id : null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      // Build filter conditions
      const conditions: string[] = ["f.organization_id = $1"];
      const params: unknown[] = [organizationId];

      const filterStatus = isNonEmptyString(req.query.status)
        ? req.query.status
        : null;
      if (filterStatus !== null) {
        if (!VALID_STATUSES.has(filterStatus)) {
          res.status(400).json({
            error: "invalid_status_filter",
            allowed: [...VALID_STATUSES]
          });
          return;
        }
        params.push(filterStatus);
        conditions.push(`f.status = $${params.length}`);
      }

      const filterSeverity = isNonEmptyString(req.query.severity)
        ? req.query.severity
        : null;
      if (filterSeverity !== null) {
        if (!VALID_SEVERITIES.has(filterSeverity)) {
          res.status(400).json({
            error: "invalid_severity_filter",
            allowed: [...VALID_SEVERITIES]
          });
          return;
        }
        params.push(filterSeverity);
        conditions.push(`f.severity = $${params.length}`);
      }

      const filterSourceType = isNonEmptyString(req.query.source_type)
        ? req.query.source_type
        : null;
      if (filterSourceType !== null) {
        if (!VALID_SOURCE_TYPES.has(filterSourceType)) {
          res.status(400).json({
            error: "invalid_source_type_filter",
            allowed: [...VALID_SOURCE_TYPES]
          });
          return;
        }
        params.push(filterSourceType);
        conditions.push(`f.source_type = $${params.length}`);
      }

      const filterDomain = isNonEmptyString(req.query.domain)
        ? req.query.domain
        : null;
      if (filterDomain !== null) {
        params.push(filterDomain);
        conditions.push(`f.domain = $${params.length}`);
      }

      // source_id: filters by the source record ID (UUID).
      // For source_type='vendor_review' this is a vendor_assessments.id —
      // NOT a vendor_id. The source_id column is polymorphic (no FK).
      const filterSourceId = isNonEmptyString(req.query.source_id)
        ? req.query.source_id
        : null;
      if (filterSourceId !== null) {
        if (!isUuid(filterSourceId)) {
          res.status(400).json({ error: "source_id_must_be_uuid" });
          return;
        }
        params.push(filterSourceId);
        conditions.push(`f.source_id = $${params.length}::uuid`);
      }

      const filterPriority = isNonEmptyString(req.query.priority)
        ? req.query.priority
        : null;
      if (filterPriority !== null) {
        if (!VALID_PRIORITIES.has(filterPriority)) {
          res.status(400).json({
            error: "invalid_priority_filter",
            allowed: [...VALID_PRIORITIES]
          });
          return;
        }
        params.push(filterPriority);
        conditions.push(`f.priority = $${params.length}`);
      }

      if (useCursor) {
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(f.created_at, f.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const result = await pg.query(
        `
        SELECT
          f.id,
          f.organization_id,
          f.assessment_id,
          f.source_type,
          f.source_id,
          f.title,
          f.severity,
          f.description,
          f.recommendation,
          f.framework_control_id,
          f.domain,
          f.priority,
          f.likelihood,
          f.confidence,
          f.time_sensitivity,
          f.scoring_rationale,
          f.status,
          f.owner_user_id,
          f.due_date,
          f.created_at,
          f.updated_at,
          (SELECT COUNT(*)::integer
           FROM actions a
           WHERE a.source_type = 'finding'
             AND a.source_id = f.id
             AND a.organization_id = f.organization_id
          ) AS action_count
        FROM findings f
        ${whereClause}
        ORDER BY
          CASE f.priority
            WHEN 'immediate'  THEN 1
            WHEN 'near_term'  THEN 2
            WHEN 'planned'    THEN 3
            WHEN 'watch'      THEN 4
            ELSE 5
          END,
          CASE f.severity
            WHEN 'Critical' THEN 1
            WHEN 'High'     THEN 2
            WHEN 'Moderate' THEN 3
            WHEN 'Low'      THEN 4
            ELSE 5
          END,
          f.created_at DESC,
          f.id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const findings = result.rows;
      const last =
        findings.length > 0 ? findings[findings.length - 1] : null;

      res.status(200).json({
        count: findings.length,
        limit,
        organizationId,
        nextCursor:
          last != null
            ? { created_at: last.created_at, id: last.id }
            : null,
        findings
      });
    } catch (err) {
      logger.error(
        { event: "findings_list_failed", err },
        "GET /api/findings failed"
      );
      res.status(500).json({ error: "findings_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/findings/summary
   Aggregate counts for findings scoped to the org.
   ========================================================= */

router.get(
  "/findings/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const result = await pg.query<{
        open_count: string;
        critical_open: string;
        high_open: string;
        medium_open: string;
        low_open: string;
        closed_count: string;
        immediate_priority: string;
        vendor_sourced: string;
        signal_sourced: string;
      }>(
        `
        SELECT
          COUNT(*) FILTER (WHERE status = 'open')                                   AS open_count,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical')         AS critical_open,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'high')             AS high_open,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'medium')           AS medium_open,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'low')              AS low_open,
          COUNT(*) FILTER (WHERE status != 'open')                                  AS closed_count,
          COUNT(*) FILTER (WHERE status = 'open' AND priority = 'immediate')        AS immediate_priority,
          COUNT(*) FILTER (WHERE source_type = 'vendor_review')                     AS vendor_sourced,
          COUNT(*) FILTER (WHERE source_type = 'signal')                            AS signal_sourced
        FROM findings
        WHERE organization_id = $1
        `,
        [organizationId]
      );

      const row = result.rows[0];
      res.status(200).json({
        summary: {
          open_count:         parseInt(row?.open_count ?? "0", 10),
          critical_open:      parseInt(row?.critical_open ?? "0", 10),
          high_open:          parseInt(row?.high_open ?? "0", 10),
          medium_open:        parseInt(row?.medium_open ?? "0", 10),
          low_open:           parseInt(row?.low_open ?? "0", 10),
          closed_count:       parseInt(row?.closed_count ?? "0", 10),
          immediate_priority: parseInt(row?.immediate_priority ?? "0", 10),
          vendor_sourced:     parseInt(row?.vendor_sourced ?? "0", 10),
          signal_sourced:     parseInt(row?.signal_sourced ?? "0", 10),
        },
      });
    } catch (err) {
      logger.error({ event: "findings_summary_failed", err }, "GET /api/findings/summary failed");
      res.status(500).json({ error: "findings_summary_failed" });
    }
  }
);

/* =========================================================
   GET /api/findings/:id
   Get a single finding with linked action count.
   Returns 404 if not found or belongs to a different org.
   ========================================================= */

router.get(
  "/findings/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const findingId = String(req.params["id"] ?? "").trim();
      if (!findingId) {
        res.status(400).json({ error: "finding_id_required" });
        return;
      }
      if (!isUuid(findingId)) {
        res.status(400).json({ error: "finding_id_must_be_uuid" });
        return;
      }

      const result = await pg.query(
        `
        SELECT
          f.id,
          f.organization_id,
          f.assessment_id,
          f.source_type,
          f.source_id,
          f.title,
          f.severity,
          f.description,
          f.recommendation,
          f.framework_control_id,
          f.domain,
          f.priority,
          f.likelihood,
          f.confidence,
          f.time_sensitivity,
          f.scoring_rationale,
          f.status,
          f.owner_user_id,
          f.due_date,
          f.created_at,
          f.updated_at,
          (SELECT COUNT(*)::integer
           FROM actions a
           WHERE a.source_type = 'finding'
             AND a.source_id = f.id
             AND a.organization_id = f.organization_id
          ) AS action_count
        FROM findings f
        WHERE f.id = $1
          AND f.organization_id = $2
        `,
        [findingId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }

      res.status(200).json({ finding: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "finding_get_failed", err },
        "GET /api/findings/:id failed"
      );
      res.status(500).json({ error: "finding_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/findings/:id
   Update status, owner, priority, or due_date of a finding.
   Returns 404 if the finding does not belong to the org.
   ========================================================= */

router.patch(
  "/findings/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const findingId = String(req.params.id ?? "").trim();
      if (!findingId) {
        res.status(400).json({ error: "finding_id_required" });
        return;
      }

      const body =
        req.body != null && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      // Collect the fields to update — at least one must be present
      const updates: string[] = [];
      const values: unknown[] = [];

      if ("status" in body) {
        const status = body["status"];
        if (!isNonEmptyString(status) || !VALID_PATCH_STATUSES.has(status)) {
          res.status(400).json({
            error: "invalid_status",
            allowed: [...VALID_PATCH_STATUSES]
          });
          return;
        }
        values.push(status);
        updates.push(`status = $${values.length}`);
      }

      if ("priority" in body) {
        const priority = body["priority"];
        if (!isNonEmptyString(priority) || !VALID_PRIORITIES.has(priority)) {
          res.status(400).json({
            error: "invalid_priority",
            allowed: [...VALID_PRIORITIES]
          });
          return;
        }
        values.push(priority);
        updates.push(`priority = $${values.length}`);
      }

      if ("owner_user_id" in body) {
        const ownerId = body["owner_user_id"];
        if (ownerId !== null && !isUuid(ownerId)) {
          res.status(400).json({ error: "owner_user_id_must_be_uuid_or_null" });
          return;
        }
        values.push(ownerId ?? null);
        updates.push(`owner_user_id = $${values.length}`);
      }

      if ("due_date" in body) {
        const dueDate = body["due_date"];
        if (dueDate !== null && !isIsoDate(dueDate)) {
          res.status(400).json({ error: "due_date_must_be_yyyy_mm_dd_or_null" });
          return;
        }
        values.push(dueDate ?? null);
        updates.push(`due_date = $${values.length}`);
      }

      if (updates.length === 0) {
        res.status(400).json({
          error: "no_updateable_fields",
          updatable: ["status", "priority", "owner_user_id", "due_date"]
        });
        return;
      }

      // Append updated_at and scoping params
      values.push(findingId, organizationId);
      const idParam = values.length - 1;
      const orgParam = values.length;

      const result = await pg.query(
        `
        UPDATE findings
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING
          id, organization_id, source_type, title, severity,
          domain, priority, status, owner_user_id, updated_at
        `,
        values
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: req.userId ?? null,
        eventType: "finding.status_changed",
        resourceType: "finding",
        resourceId: result.rows[0].id as string,
        payload: {
          status: result.rows[0].status ?? null,
          priority: result.rows[0].priority ?? null
        },
        ipAddress: req.ip ?? null
      });

      dispatchWebhookEvent({
        event_type: "finding.updated",
        organization_id: organizationId,
        data: {
          id: result.rows[0].id,
          status: result.rows[0].status,
          updated_at: result.rows[0].updated_at,
        },
      }).catch(() => {});

      res.status(200).json({ finding: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "finding_patch_failed", err },
        "PATCH /api/findings/:id failed"
      );
      res.status(500).json({ error: "finding_patch_failed" });
    }
  }
);

export default router;
