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
import { asTenant } from "../middleware/asTenant.js";
import { validateFindingCreate } from "../lib/findingValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { dispatchWebhookEvent } from "../lib/webhookDispatcher.js";
import { triggerFindingAlert } from "../lib/findingAlertTrigger.js";
import { resolveFindingContext } from "../lib/findingContextResolver.js";
import { normalizeEntityQuery, searchFindingsByEntity } from "../lib/findingEntitySearch.js";
import { resolveOwnerMeFilter } from "../lib/findingListFilters.js";
import {
  DECISION_STATES,
  evaluateFindingDecisionTransition,
} from "../lib/findingLifecycleMachine.js";
import { writeFindingLifecycleEvent } from "../lib/findingLifecycle.js";

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
// The HUMAN-GOVERNED decision axis (finding-lifecycle-spec §1.2, ratified set —
// 'in_progress' was pre-ratification drift, normalized away by 20260901).
// Transitions are guarded by findingLifecycle.evaluateFindingDecisionTransition.
const VALID_DECISION_STATES = new Set<string>(DECISION_STATES);

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

   A04-G1 PR β2: wrapped in asTenant — all five findings customer routes
   (GET list / summary / :id from PR α, and this POST + the PATCH below) now run
   inside the per-request tenant transaction. This was deferred in PR α because
   the write paths schedule fire-and-forget work; PR β1 closed that gap by
   moving the webhook dispatcher to pgElevated. The remaining non-awaited side
   effects are all safe under the wrap: writeAuditEvent (pgElevated),
   triggerFindingAlert (opens its own withTenant), dispatchWebhookEvent
   (pgElevated since β1) — none touch the request's tenant client. The awaited
   risk-ownership SELECT and the INSERT run in-scope, which is the point: after
   the operator DATABASE_URL flip the findings RLS policy enforces on writes too.
   See docs/A04-G1-pr-beta-design.md and feedback_route_wrap_fire_and_forget.
   ========================================================= */

router.post(
  "/findings",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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
  })
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
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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

      // Ops-center work filters (ERIP work-first Findings) — all additive and
      // server-side so decision buckets stay correct at 20k+ findings (the UI
      // never client-filters a page to fake a bucket).
      if (req.query.decision_state !== undefined) {
        const ds = isNonEmptyString(req.query.decision_state) ? req.query.decision_state : "";
        if (!VALID_DECISION_STATES.has(ds)) {
          res.status(400).json({
            error: "invalid_decision_state_filter",
            allowed: [...VALID_DECISION_STATES]
          });
          return;
        }
        params.push(ds);
        conditions.push(`f.decision_state = $${params.length}`);
      }

      if (req.query.overdue === "true") {
        conditions.push(`f.status IN ('open', 'in_progress') AND f.due_date IS NOT NULL AND f.due_date < CURRENT_DATE`);
      }

      if (req.query.unassigned === "true") {
        conditions.push(`f.status IN ('open', 'in_progress') AND f.owner_user_id IS NULL`);
      }

      // active=true — still requires work (open or in progress). Buckets pass this
      // so their views exclude closed/resolved items unless the user browses.
      if (req.query.active === "true") {
        conditions.push(`f.status IN ('open', 'in_progress')`);
      }

      // ready_for_decision=true — the spec §1.3 "ready for decision" queue: all
      // remediation work is done (operational_status derived to 'remediated')
      // but leadership has not yet made the governance call. A QUERY, never a
      // decision_state write — the system only exposes the prompt (R3).
      if (req.query.ready_for_decision === "true") {
        conditions.push(
          `f.operational_status = 'remediated' AND f.decision_state NOT IN ('resolved', 'accepted_risk')`
        );
      }

      // owner=me — the caller's own assigned work ("My Work" bucket). The ONLY
      // accepted value is the literal "me"; the user id resolves SERVER-SIDE from
      // the session (req.userId). Any other value is rejected — assignments can
      // never be enumerated by passing a user id.
      const ownerFilter = resolveOwnerMeFilter(req.query.owner, (req.userId as string | undefined) ?? null);
      if (ownerFilter.kind === "error") {
        res.status(400).json({ error: ownerFilter.error });
        return;
      }
      if (ownerFilter.kind === "me") {
        params.push(ownerFilter.userId);
        conditions.push(`f.owner_user_id = $${params.length}`);
      }

      // exploited=true — findings whose supporting intelligence shows active
      // exploitation: the source Intelligence Event has ever_exploited, the source
      // signal bridges to such an event, or the source signal is CISA KEV.
      if (req.query.exploited === "true") {
        conditions.push(`(
          (f.source_type = 'intelligence_event' AND EXISTS (
             SELECT 1 FROM intelligence_events e
              WHERE e.id = f.source_id AND e.ever_exploited))
          OR (f.source_type IN ('cyber_signal', 'signal') AND (
             EXISTS (
               SELECT 1 FROM intelligence_event_sources ies
                 JOIN intelligence_events e ON e.id = ies.event_id
                WHERE ies.cyber_signal_id = f.source_id AND e.ever_exploited)
             OR EXISTS (
               SELECT 1 FROM cyber_signals cs
                WHERE cs.id = f.source_id AND cs.source = 'cisa-kev')
          ))
        )`);
      }

      // Exact filtered total for pagination — same conditions/params BEFORE the
      // cursor predicate (the cursor narrows the page, never the total).
      const preCursorConditions = [...conditions];
      const preCursorParams = [...params];

      if (useCursor) {
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(f.created_at, f.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      // Stable keyset ordering: the cursor predicate compares (created_at, id), so
      // paged requests MUST sort by (created_at DESC, id DESC) or pages would skip
      // and duplicate rows as data changes. Cursor requests force it; first pages
      // opt in via ?sort=created so every page of a paged view shares one order.
      // The legacy default (priority → severity → created_at) is unchanged.
      const stableSort = useCursor || req.query.sort === "created";

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
          f.decision_state,
          f.operational_status,
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
          ${stableSort ? "" : `CASE f.priority
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
          END,`}
          f.created_at DESC,
          f.id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      // Exact total for the SAME filter set (cursor excluded) — pagination truth.
      const totalRow = await pg.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM findings f WHERE ${preCursorConditions.join(" AND ")}`,
        preCursorParams
      );
      const total = parseInt(totalRow.rows[0]?.total ?? "0", 10);

      const findings = result.rows;
      const last =
        findings.length > 0 ? findings[findings.length - 1] : null;

      res.status(200).json({
        count: findings.length,
        limit,
        total,
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
  })
);

/* =========================================================
   GET /api/findings/summary
   Aggregate counts for findings scoped to the org.
   ========================================================= */

router.get(
  "/findings/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'Critical')         AS critical_open,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'High')             AS high_open,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'Moderate')         AS medium_open,
          COUNT(*) FILTER (WHERE status = 'open' AND severity = 'Low')              AS low_open,
          COUNT(*) FILTER (WHERE status != 'open')                                  AS closed_count,
          COUNT(*) FILTER (WHERE status = 'open' AND priority = 'immediate')        AS immediate_priority,
          COUNT(*) FILTER (WHERE source_type = 'vendor_review')                     AS vendor_sourced,
          COUNT(*) FILTER (WHERE source_type = 'signal')                            AS signal_sourced,
          -- Work-queue counts (ERIP work-first Findings page) — additive.
          COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date < CURRENT_DATE) AS overdue_open,
          COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND owner_user_id IS NULL)                            AS unassigned_open,
          COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND decision_state = 'needs_review')                  AS needs_review_open,
          COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND decision_state = 'mitigating')                    AS mitigating_open,
          COUNT(*) FILTER (WHERE decision_state = 'accepted_risk')                                                      AS accepted_risk_total,
          -- Ready for decision (spec §1.3): work derived complete, governance pending.
          COUNT(*) FILTER (WHERE operational_status = 'remediated' AND decision_state NOT IN ('resolved','accepted_risk')) AS ready_for_decision_open,
          -- Ops-center domain buckets (server truth at any scale) — additive.
          COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND domain = 'Regulatory')                            AS regulatory_open,
          COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND domain = 'AI Governance')                         AS ai_governance_open,
          COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND domain = 'Vendor Risk')                           AS vendor_risk_open,
          -- Active exploitation: same predicate as the list's exploited=true filter.
          (SELECT COUNT(*) FROM findings f2
            WHERE f2.organization_id = $1 AND f2.status IN ('open','in_progress') AND (
              (f2.source_type = 'intelligence_event' AND EXISTS (
                 SELECT 1 FROM intelligence_events e WHERE e.id = f2.source_id AND e.ever_exploited))
              OR (f2.source_type IN ('cyber_signal', 'signal') AND (
                 EXISTS (SELECT 1 FROM intelligence_event_sources ies
                           JOIN intelligence_events e ON e.id = ies.event_id
                          WHERE ies.cyber_signal_id = f2.source_id AND e.ever_exploited)
                 OR EXISTS (SELECT 1 FROM cyber_signals cs
                             WHERE cs.id = f2.source_id AND cs.source = 'cisa-kev')))
            ))                                                                                                          AS exploited_open
        FROM findings
        WHERE organization_id = $1
        `,
        [organizationId]
      );

      // Awaiting Approval is risk-lifecycle work (risk_approvals), surfaced on the
      // ops center alongside finding buckets. Read-only count; org-scoped.
      const approvals = await pg.query<{ pending: string }>(
        `SELECT COUNT(*) AS pending FROM risk_approvals WHERE organization_id = $1 AND decision = 'pending'`,
        [organizationId]
      );

      // "My Work" — the caller's own open assignments. The user id resolves from
      // the SESSION identity only (owner=me contract); API-key callers have no
      // user identity, so the field is omitted → the UI shows an honest unknown.
      const summaryUserId = (req.userId as string | undefined) ?? null;
      const myWork = summaryUserId
        ? await pg.query<{ mine: string }>(
            `SELECT COUNT(*) AS mine FROM findings
              WHERE organization_id = $1 AND owner_user_id = $2 AND status IN ('open','in_progress')`,
            [organizationId, summaryUserId]
          )
        : null;

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
          // Work-queue counts (ERIP work-first Findings page) — additive.
          overdue_open:        parseInt((row as any)?.overdue_open ?? "0", 10),
          unassigned_open:     parseInt((row as any)?.unassigned_open ?? "0", 10),
          needs_review_open:   parseInt((row as any)?.needs_review_open ?? "0", 10),
          mitigating_open:     parseInt((row as any)?.mitigating_open ?? "0", 10),
          accepted_risk_total: parseInt((row as any)?.accepted_risk_total ?? "0", 10),
          ready_for_decision_open: parseInt((row as any)?.ready_for_decision_open ?? "0", 10),
          // Ops-center buckets (ERIP work-first) — additive.
          regulatory_open:        parseInt((row as any)?.regulatory_open ?? "0", 10),
          ai_governance_open:     parseInt((row as any)?.ai_governance_open ?? "0", 10),
          vendor_risk_open:       parseInt((row as any)?.vendor_risk_open ?? "0", 10),
          exploited_open:         parseInt((row as any)?.exploited_open ?? "0", 10),
          pending_risk_approvals: parseInt(approvals.rows[0]?.pending ?? "0", 10),
          ...(myWork ? { my_work_open: parseInt(myWork.rows[0]?.mine ?? "0", 10) } : {}),
        },
      });
    } catch (err) {
      logger.error({ event: "findings_summary_failed", err }, "GET /api/findings/summary failed");
      res.status(500).json({ error: "findings_summary_failed" });
    }
  })
);

/* =========================================================
   GET /api/findings/by-entity?q=<name>
   ERIP work-first Findings page — DARK behind
   SECURELOGIC_DECISION_WORKSPACE_ENABLED (404 while off, same
   posture as /findings/:id/context). Reverse entity search:
   "which findings belong to <vendor/AI system/control/obligation>".
   Read-only; resolves through existing signal links, the
   intelligence-event bridge, and the assessment tables. MUST be
   registered BEFORE /findings/:id so the path is not captured.
   ========================================================= */

router.get(
  "/findings/by-entity",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      if (process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED !== "true") {
        res.status(404).json({ error: "findings_by_entity_not_found" });
        return;
      }
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      const q = normalizeEntityQuery(req.query["q"]);
      if (!q) {
        res.status(400).json({ error: "query_must_be_2_to_120_chars" });
        return;
      }

      const { entities, finding_ids } = await searchFindingsByEntity(pg, organizationId, q);
      if (finding_ids.length === 0) {
        res.status(200).json({ query: q, entities, count: 0, findings: [] });
        return;
      }

      const rows = await pg.query(
        `
        SELECT
          f.id, f.organization_id, f.assessment_id, f.source_type, f.source_id,
          f.title, f.severity, f.description, f.recommendation, f.framework_control_id,
          f.domain, f.priority, f.likelihood, f.confidence, f.time_sensitivity,
          f.scoring_rationale, f.status, f.decision_state, f.operational_status, f.owner_user_id, f.due_date,
          f.created_at, f.updated_at,
          (SELECT COUNT(*)::integer FROM actions a
            WHERE a.source_type = 'finding' AND a.source_id = f.id
              AND a.organization_id = f.organization_id) AS action_count
        FROM findings f
        WHERE f.organization_id = $1 AND f.id = ANY($2::uuid[])
        ORDER BY
          CASE f.severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Moderate' THEN 3 WHEN 'Low' THEN 4 ELSE 5 END,
          f.created_at DESC
        `,
        [organizationId, finding_ids]
      );

      res.status(200).json({ query: q, entities, count: rows.rows.length, findings: rows.rows });
    } catch (err) {
      logger.error({ event: "findings_by_entity_failed", err }, "GET /api/findings/by-entity failed");
      res.status(500).json({ error: "findings_by_entity_failed" });
    }
  })
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
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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
          f.decision_state,
          f.operational_status,
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
  })
);

/* =========================================================
   GET /api/findings/:id/context
   ERIP Package 3 (Decision Workspace), Phase 3.0 — DARK.
   Read-only composition of everything the Decision Workspace needs
   (affected entities, supporting Intelligence Events + sources +
   timeline, evidence, related findings, owner, activity, what's
   changed) so the customer never page-hops. 404s when the finding
   is not in the org OR the flag is off (two-switch dark launch).
   ========================================================= */

router.get(
  "/findings/:id/context",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      // Dark: the whole endpoint 404s until the Decision Workspace flag flips.
      if (process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED !== "true") {
        res.status(404).json({ error: "finding_context_not_found" });
        return;
      }

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

      const sinceRaw = req.query["since"];
      let since = typeof sinceRaw === "string" && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null;

      // What's-Changed (P3.2a): default the marker to THIS user's last review of
      // this finding when the caller didn't pass an explicit ?since.
      const userId = (req.userId as string | undefined) ?? null;
      if (since === null && userId) {
        const mark = await pg.query(
          `SELECT last_reviewed_at FROM finding_review_marks
            WHERE organization_id = $1 AND finding_id = $2 AND user_id = $3`,
          [organizationId, findingId, userId]
        );
        if ((mark.rowCount ?? 0) > 0) since = new Date(mark.rows[0].last_reviewed_at).toISOString();
      }

      const context = await resolveFindingContext(pg, organizationId, findingId, { since });
      if (context === null) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }

      res.status(200).json({ context });
    } catch (err) {
      logger.error(
        { event: "finding_context_failed", err },
        "GET /api/findings/:id/context failed"
      );
      res.status(500).json({ error: "finding_context_failed" });
    }
  })
);

/* =========================================================
   POST /api/findings/:id/review
   ERIP Package 3 (Decision Workspace), Phase 3.2a — DARK.
   Upserts the current user's "last reviewed" marker for this
   finding so the What's-Changed zone can show changes since the
   user's own previous review. 404s when the finding is not in the
   org OR the flag is off. Requires a user identity (JWT); API-key-
   only callers get 400 (no user to mark for).
   ========================================================= */

router.post(
  "/findings/:id/review",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      if (process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED !== "true") {
        res.status(404).json({ error: "finding_review_not_found" });
        return;
      }

      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const findingId = String(req.params["id"] ?? "").trim();
      if (!isUuid(findingId)) {
        res.status(400).json({ error: "finding_id_must_be_uuid" });
        return;
      }

      const userId = (req.userId as string | undefined) ?? null;
      if (!userId) {
        res.status(400).json({ error: "review_requires_user_identity" });
        return;
      }

      // Pre-flight: the finding must be in this org (avoids marking a foreign id).
      const exists = await pg.query(
        `SELECT 1 FROM findings WHERE id = $1 AND organization_id = $2`,
        [findingId, organizationId]
      );
      if ((exists.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }

      const upsert = await pg.query(
        `INSERT INTO finding_review_marks (organization_id, finding_id, user_id, last_reviewed_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (organization_id, finding_id, user_id)
         DO UPDATE SET last_reviewed_at = NOW(), updated_at = NOW()
         RETURNING last_reviewed_at`,
        [organizationId, findingId, userId]
      );

      // Mark-Reviewed is a per-user acknowledgement (it advances THIS user's
      // "What's changed since your last review" baseline), NOT a status/decision
      // transition. It was previously unaudited — an invisible action. Record it
      // so the audit trail shows who reviewed a finding and when, without
      // implying any lifecycle change.
      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: userId,
        eventType: "finding.reviewed",
        resourceType: "finding",
        resourceId: findingId,
        payload: { reviewed_at: upsert.rows[0].last_reviewed_at },
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({ reviewed_at: upsert.rows[0].last_reviewed_at });
    } catch (err) {
      logger.error({ event: "finding_review_failed", err }, "POST /api/findings/:id/review failed");
      res.status(500).json({ error: "finding_review_failed" });
    }
  })
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
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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

      // decision_state — the HUMAN-GOVERNED axis (finding-lifecycle-spec §1.2/§4).
      // Dark: only accepted when the Decision Workspace flag is on, so flag-off
      // PATCH behaviour is unchanged. NOT a free write: the requested value is a
      // TRANSITION, guarded by the pure state machine (close requires derived
      // remediation or an accepted-risk override), and every allowed transition
      // appends a finding_lifecycle_events row in this same tenant transaction.
      let decisionTransition:
        | ReturnType<typeof evaluateFindingDecisionTransition>
        | null = null;
      if (process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED === "true" && "decision_state" in body) {
        const ds = body["decision_state"];
        if (!isNonEmptyString(ds) || !VALID_DECISION_STATES.has(ds)) {
          res.status(400).json({ error: "invalid_decision_state", allowed: [...VALID_DECISION_STATES] });
          return;
        }
        const current = await pg.query<{ decision_state: string; operational_status: string }>(
          `SELECT decision_state, operational_status FROM findings
            WHERE id = $1 AND organization_id = $2
            FOR UPDATE`,
          [findingId, organizationId]
        );
        const currentRow = current.rows[0];
        if (!currentRow) {
          res.status(404).json({ error: "finding_not_found" });
          return;
        }
        decisionTransition = evaluateFindingDecisionTransition(
          currentRow.decision_state,
          ds,
          { operationalStatus: currentRow.operational_status }
        );
        if (!decisionTransition.allowed) {
          res.status(409).json({
            error: "invalid_decision_transition",
            reason: decisionTransition.reason,
            from: currentRow.decision_state,
            to: ds,
            operational_status: currentRow.operational_status,
          });
          return;
        }
        values.push(ds);
        updates.push(`decision_state = $${values.length}`);
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
          domain, priority, status, decision_state, operational_status,
          owner_user_id, due_date, updated_at
        `,
        values
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }

      // Governance transition: append the in-transaction lifecycle event (spec
      // §6.2) and project the spec-named audit event. No-op re-selects write
      // nothing (idempotent).
      if (decisionTransition?.allowed && !decisionTransition.noop && decisionTransition.transition) {
        await writeFindingLifecycleEvent({
          organizationId,
          findingId,
          axis: "decision",
          fromState: decisionTransition.fromState ?? null,
          toState: decisionTransition.toState as string,
          transition: decisionTransition.transition,
          actor: {
            actorUserId: (req.userId as string | undefined) ?? null,
            actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
          },
        });
        writeAuditEvent({
          organizationId,
          actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
          actorUserId: req.userId ?? null,
          eventType: decisionTransition.auditEvent ?? "finding.decision_changed",
          resourceType: "finding",
          resourceId: result.rows[0].id as string,
          payload: {
            from: decisionTransition.fromState ?? null,
            to: decisionTransition.toState ?? null,
            operational_status: result.rows[0].operational_status ?? null,
          },
          ipAddress: req.ip ?? null,
        });
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: req.userId ?? null,
        eventType: "finding.status_changed",
        resourceType: "finding",
        resourceId: result.rows[0].id as string,
        payload: {
          // The full mutation set — owner and due-date changes were previously
          // invisible in the audit payload (workflow-audit gap).
          status: result.rows[0].status ?? null,
          priority: result.rows[0].priority ?? null,
          decision_state: result.rows[0].decision_state ?? null,
          owner_user_id: result.rows[0].owner_user_id ?? null,
          due_date: result.rows[0].due_date ?? null,
          changed_fields: Object.keys(body).filter((k) =>
            ["status", "priority", "owner_user_id", "due_date", "decision_state"].includes(k)
          ),
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
  })
);

export default router;
