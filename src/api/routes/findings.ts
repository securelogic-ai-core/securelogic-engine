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

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_STATUSES = new Set(["open", "in_progress", "closed"]);
const VALID_SEVERITIES = new Set(["Critical", "High", "Moderate", "Low"]);
const VALID_SOURCE_TYPES = new Set([
  "assessment",
  "control_test",
  "vendor_review",
  "ai_review",
  "obligation_review",
  "dependency_review",
  "signal",
  "manual",
  "risk"
]);
const VALID_PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);
const VALID_PATCH_STATUSES = new Set(["open", "in_progress", "closed"]);

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
        owner_user_id,
        due_date
      } = validation.input;

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
          f.created_at,
          f.updated_at
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
   PATCH /api/findings/:id
   Update status, owner, or priority of a finding.
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

      if (updates.length === 0) {
        res.status(400).json({
          error: "no_updateable_fields",
          updatable: ["status", "priority", "owner_user_id"]
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
