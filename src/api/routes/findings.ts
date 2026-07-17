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
  isLegacyTerminal,
} from "../lib/findingLifecycleMachine.js";
import {
  evaluateFindingClosure,
  findingClosureGateEnabled,
  loadClosureBlockers,
} from "../lib/findingClosurePolicy.js";
import { applyLegacyStatusTransition } from "../lib/findingClosureService.js";
import { riskAcceptanceEnabled } from "../lib/riskAcceptanceFeatureFlag.js";
import {
  directRiskAcceptanceBlocked,
  USE_RISK_ACCEPTANCE_WORKFLOW_ERROR,
} from "../lib/findingAcceptanceWorkflow.js";
import {
  writeFindingLifecycleEvent,
  recomputeFindingOperationalStatus,
} from "../lib/findingLifecycle.js";
import {
  sqlFindingActive,
  sqlFindingClosed,
  sqlFindingOverdue,
  sqlFindingStrictlyOpen,
} from "../lib/metricDefinitions.js";
import { resolveSlaDueDate } from "../lib/findingSlaPolicy.js";
import { buildSignalFindingTitle, resolveSignalDomain } from "../lib/signalFindingShape.js";
import { severityToPriority } from "../lib/postureComputation.js";
import {
  VALID_QUEUE_SORTS,
  VALID_DUE_STATUSES,
  dueStatusCondition,
  queueOrderBy,
  type QueueSort,
  type DueStatus,
} from "../lib/findingsQueueOrdering.js";
import {
  normalizeSearchQuery,
  searchLikePattern,
  resolveSearchFindingIds,
} from "../lib/findingQuerySearch.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
// Cap OFFSET so a hostile ?offset can't force an unbounded deep scan.
const MAX_OFFSET = 100_000;

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
// The SYSTEM-DERIVED operational axis (finding-lifecycle-spec §1.1).
const VALID_OPERATIONAL_STATUSES = new Set(["open", "in_progress", "remediated", "closed"]);
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

/** Non-negative page offset, bounded. Invalid input fails safe to 0. */
function parseOffset(value: unknown): number {
  if (value === undefined) return 0;
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), MAX_OFFSET);
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

      // SLA policy (20260903): when the caller sets no due date, default it
      // from the org's severity→days policy — the SLA Breached queue is only
      // as real as its due-date source. No policy → null (unchanged).
      const effective_due_date =
        due_date ?? (await resolveSlaDueDate(organizationId, severity as string | null));

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
          effective_due_date
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
        conditions.push(`${sqlFindingOverdue("f.operational_status", "f.due_date")}`);
      }

      if (req.query.unassigned === "true") {
        conditions.push(`${sqlFindingActive("f.operational_status")} AND f.owner_user_id IS NULL`);
      }

      // active=true — still requires work (open or in progress). Buckets pass this
      // so their views exclude closed/resolved items unless the user browses.
      if (req.query.active === "true") {
        conditions.push(sqlFindingActive("f.operational_status"));
      }

      // intel_ref=<cyber_signal_id> — resolve findings across BOTH intelligence
      // channels for one signal: the legacy per-signal finding (source_type
      // cyber_signal/signal, source_id = signal) AND the event-native finding
      // (source_type intelligence_event, source_id = an event the signal
      // contributed to, via the intelligence_event_sources bridge). The Brief's
      // decision affordance uses this — a brief item knows only its signal id,
      // and without the bridge the event-sourced finding the pipeline actually
      // creates was unreachable from the brief (dead-end).
      if (req.query.intel_ref !== undefined) {
        const ref = isNonEmptyString(req.query.intel_ref) ? req.query.intel_ref.trim() : "";
        if (!isUuid(ref)) {
          res.status(400).json({ error: "intel_ref_must_be_uuid" });
          return;
        }
        params.push(ref);
        const refParam = params.length;
        conditions.push(`(
          (f.source_type IN ('cyber_signal', 'signal') AND f.source_id = $${refParam}::uuid)
          OR (f.source_type = 'intelligence_event' AND f.source_id IN (
            SELECT ies.event_id FROM intelligence_event_sources ies
             WHERE ies.cyber_signal_id = $${refParam}::uuid))
        )`);
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

      // operational_status=<state> — the SYSTEM-DERIVED axis (spec §1.1). Kept
      // distinct from ?status (legacy) and ?decision_state (governance).
      const filterOperationalStatus = isNonEmptyString(req.query.operational_status)
        ? req.query.operational_status
        : null;
      if (filterOperationalStatus !== null) {
        if (!VALID_OPERATIONAL_STATUSES.has(filterOperationalStatus)) {
          res.status(400).json({
            error: "invalid_operational_status_filter",
            allowed: [...VALID_OPERATIONAL_STATUSES],
          });
          return;
        }
        params.push(filterOperationalStatus);
        conditions.push(`f.operational_status = $${params.length}`);
      }

      // due=<overdue|today|soon|none> — due-status partition, server-side so the
      // SLA buckets stay correct at scale. Predicates reuse the Metric Contract
      // (sqlFindingActive/sqlFindingOverdue); values are constants (no param).
      if (req.query.due !== undefined) {
        const due = isNonEmptyString(req.query.due) ? req.query.due.trim() : "";
        if (!VALID_DUE_STATUSES.has(due)) {
          res.status(400).json({ error: "invalid_due_filter", allowed: [...VALID_DUE_STATUSES] });
          return;
        }
        conditions.push(dueStatusCondition(due as DueStatus));
      }

      // has_action=true / has_evidence=true — findings that have at least one
      // linked remediation Action / evidence item (polymorphic source join,
      // org-scoped). EXISTS, not the correlated COUNT in the SELECT, so the
      // filter short-circuits.
      if (req.query.has_action === "true") {
        conditions.push(
          `EXISTS (SELECT 1 FROM actions a WHERE a.source_type = 'finding' ` +
            `AND a.source_id = f.id AND a.organization_id = f.organization_id)`
        );
      }
      if (req.query.has_evidence === "true") {
        conditions.push(
          `EXISTS (SELECT 1 FROM evidence e WHERE e.source_type = 'finding' ` +
            `AND e.source_id = f.id AND e.organization_id = f.organization_id)`
        );
      }

      // created_from / created_to — inclusive date range on when the finding was
      // raised. `to` is inclusive of the whole day (created_at is a timestamptz).
      if (req.query.created_from !== undefined) {
        if (!isIsoDate(req.query.created_from)) {
          res.status(400).json({ error: "created_from_must_be_iso_date" });
          return;
        }
        params.push(String(req.query.created_from).trim());
        conditions.push(`f.created_at >= $${params.length}::date`);
      }
      if (req.query.created_to !== undefined) {
        if (!isIsoDate(req.query.created_to)) {
          res.status(400).json({ error: "created_to_must_be_iso_date" });
          return;
        }
        params.push(String(req.query.created_to).trim());
        conditions.push(`f.created_at < ($${params.length}::date + INTERVAL '1 day')`);
      }

      // q=<text> — free-text search across title, description, finding id, CVE,
      // and the name of the linked vendor / AI system / control / obligation
      // (the monitored "asset"). Direct columns match inline; the indirect
      // dimensions (CVE + entity name) resolve — org-scoped — to a bounded id
      // set that is OR'd in. Empty / oversized q is ignored (no filter).
      const searchQuery = normalizeSearchQuery(req.query.q);
      if (searchQuery !== null) {
        const indirectIds = await resolveSearchFindingIds(pg, organizationId, searchQuery);
        params.push(searchLikePattern(searchQuery));
        const likeParam = params.length;
        params.push(indirectIds);
        const idsParam = params.length;
        conditions.push(
          `(f.title ILIKE $${likeParam} OR f.description ILIKE $${likeParam} ` +
            `OR f.id::text ILIKE $${likeParam} OR f.id = ANY($${idsParam}::uuid[]))`
        );
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

      // Sort resolution. Three families, mutually exclusive per request:
      //  - a queue sort (urgency|severity|due_date|newest|oldest) → OFFSET paging
      //    with the scalable-queue ORDER BY (findingsQueueOrdering).
      //  - ?sort=created OR a cursor request → the legacy stable keyset
      //    (created_at DESC, id DESC), unchanged.
      //  - no sort → the legacy default (priority → severity → created_at).
      const sortParam = isNonEmptyString(req.query.sort) ? String(req.query.sort).trim() : null;
      if (sortParam !== null && sortParam !== "created" && !VALID_QUEUE_SORTS.has(sortParam)) {
        res.status(400).json({ error: "invalid_sort", allowed: ["created", ...VALID_QUEUE_SORTS] });
        return;
      }
      const queueSort: QueueSort | null =
        sortParam !== null && VALID_QUEUE_SORTS.has(sortParam) ? (sortParam as QueueSort) : null;
      const stableSort = useCursor || sortParam === "created";

      // OFFSET paging powers the scalable queue (arbitrary sort + jump-to-page).
      // The keyset cursor stays the legacy path; a request never mixes the two.
      const offset = useCursor ? 0 : parseOffset(req.query.offset);
      const useOffset = !useCursor && (queueSort !== null || req.query.offset !== undefined);

      // Legacy default ORDER BY (priority → severity → created_at) — preserved
      // byte-for-byte for callers that pass no sort.
      const defaultOrderBy =
        `CASE f.priority
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
          f.id DESC`;
      const orderByBody = queueSort
        ? queueOrderBy(queueSort)
        : stableSort
          ? "f.created_at DESC, f.id DESC"
          : defaultOrderBy;

      params.push(limit);
      const limitParam = params.length;
      let paginationClause = `LIMIT $${limitParam}`;
      if (useOffset && offset > 0) {
        params.push(offset);
        paginationClause += ` OFFSET $${params.length}`;
      }

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
          ) AS action_count,
          (SELECT COUNT(*)::integer
           FROM evidence e
           WHERE e.source_type = 'finding'
             AND e.source_id = f.id
             AND e.organization_id = f.organization_id
          ) AS evidence_count
        FROM findings f
        ${whereClause}
        ORDER BY ${orderByBody}
        ${paginationClause}
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
        // OFFSET paging echoes the offset so the client can render "page N of M";
        // cursor/default paging keeps offset 0 and drives paging off nextCursor.
        offset: useOffset ? offset : 0,
        organizationId,
        nextCursor:
          !useOffset && last != null
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
        critical_active: string;
        high_active: string;
        medium_active: string;
        low_active: string;
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
          -- STRICTLY OPEN (lifecycle filter, NOT the enterprise metric): untouched
          -- work nobody has started. Retained as an explicit, honestly-named
          -- population; every enterprise tile below reads the *_active twins.
          COUNT(*) FILTER (WHERE ${sqlFindingStrictlyOpen()})                       AS open_count,
          COUNT(*) FILTER (WHERE status = 'in_progress')                            AS in_progress_open,
          -- Metric Contract: org-truth for the workspace attention tiles (same
          -- ACTIVE definition as decisionQueue.isActiveStatus client-side).
          COUNT(*) FILTER (WHERE ${sqlFindingActive()})                             AS active_total,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity IN ('Critical','High')) AS critical_high_active,
          -- ACTIVE by severity — THE enterprise severity population. A Critical
          -- finding under remediation is still a Critical finding; the strictly-open
          -- twins below empty themselves the moment someone starts work.
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'Critical')   AS critical_active,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'High')       AS high_active,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'Moderate')   AS medium_active,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND severity = 'Low')        AS low_active,
          COUNT(*) FILTER (WHERE ${sqlFindingStrictlyOpen()} AND severity = 'Critical') AS critical_open,
          COUNT(*) FILTER (WHERE ${sqlFindingStrictlyOpen()} AND severity = 'High')     AS high_open,
          COUNT(*) FILTER (WHERE ${sqlFindingStrictlyOpen()} AND severity = 'Moderate') AS medium_open,
          COUNT(*) FILTER (WHERE ${sqlFindingStrictlyOpen()} AND severity = 'Low')      AS low_open,
          -- Was status != 'open', which counted every in_progress finding as
          -- CLOSED — work in flight reported as work done. Closed is the terminal
          -- state on the authoritative axis, and the exact complement of Active.
          COUNT(*) FILTER (WHERE ${sqlFindingClosed()})                             AS closed_count,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND priority = 'immediate')  AS immediate_priority,
          COUNT(*) FILTER (WHERE source_type = 'vendor_review')                     AS vendor_sourced,
          COUNT(*) FILTER (WHERE source_type = 'signal')                            AS signal_sourced,
          -- Work-queue counts (ERIP work-first Findings page) — additive.
          COUNT(*) FILTER (WHERE ${sqlFindingOverdue()}) AS overdue_open,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND owner_user_id IS NULL)                            AS unassigned_open,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND decision_state = 'needs_review')                  AS needs_review_open,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND decision_state = 'mitigating')                    AS mitigating_open,
          COUNT(*) FILTER (WHERE decision_state = 'accepted_risk')                                                      AS accepted_risk_total,
          -- Ready for decision (spec §1.3): work derived complete, governance pending.
          COUNT(*) FILTER (WHERE operational_status = 'remediated' AND decision_state NOT IN ('resolved','accepted_risk')) AS ready_for_decision_open,
          -- Ops-center domain buckets (server truth at any scale) — additive.
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND domain = 'Regulatory')                            AS regulatory_open,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND domain = 'AI Governance')                         AS ai_governance_open,
          COUNT(*) FILTER (WHERE ${sqlFindingActive()} AND domain = 'Vendor Risk')                           AS vendor_risk_open,
          -- Active exploitation: same predicate as the list's exploited=true filter.
          (SELECT COUNT(*) FROM findings f2
            WHERE f2.organization_id = $1 AND ${sqlFindingActive("f2.operational_status")} AND (
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
              WHERE organization_id = $1 AND owner_user_id = $2 AND ${sqlFindingActive()}`,
            [organizationId, summaryUserId]
          )
        : null;

      const row = result.rows[0];
      res.status(200).json({
        summary: {
          open_count:         parseInt(row?.open_count ?? "0", 10),
          in_progress_open:   parseInt((row as any)?.in_progress_open ?? "0", 10),
          active_total:       parseInt((row as any)?.active_total ?? "0", 10),
          critical_high_active: parseInt((row as any)?.critical_high_active ?? "0", 10),
          // ACTIVE by severity — what every enterprise severity tile now reads.
          critical_active:    parseInt(row?.critical_active ?? "0", 10),
          high_active:        parseInt(row?.high_active ?? "0", 10),
          medium_active:      parseInt(row?.medium_active ?? "0", 10),
          low_active:         parseInt(row?.low_active ?? "0", 10),
          // Strictly-open twins — the lifecycle population, kept for explicit use.
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
          ) AS action_count,
          (SELECT COUNT(*)::integer
           FROM evidence e
           WHERE e.source_type = 'finding'
             AND e.source_id = f.id
             AND e.organization_id = f.organization_id
          ) AS evidence_count
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

/* =========================================================
   POST /api/findings/from-signal
   Promote an Intelligence Brief signal into a canonical Finding.

   THE MISSING FIRST HOP. Findings born from intelligence were only ever created
   by machine: the ingestion path (cyberSignalProcessingService) creates one ONLY
   when a signal matches a vendor or AI system already in the org's registry.
   Every other signal — including every signal about a technology the org has not
   registered — could be READ in the Brief and then acted on nowhere. The Brief's
   honest "no finding" affordance pointed at /queue, but /queue accepts suggested
   LINKS (signal↔vendor/control rows); it has never created a Finding. So the
   Decision Workspace, Risk Acceptance, remediation and closure — the whole
   downstream chain — sat behind an input a customer had no way to produce.

   This is that input: the reader of a Brief item asserts "this matters to us",
   and gets a canonical Finding they can own, decide, and remediate.

   Dark behind the Decision Workspace flag (404 when off), like the rest of the
   chain it feeds.
   ========================================================= */

router.post(
  "/findings/from-signal",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    if (process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED !== "true") {
      res.status(404).json({ error: "not_found" });
      return;
    }

    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const body =
        req.body != null && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      const signalId = isNonEmptyString(body["signal_id"]) ? body["signal_id"].trim() : "";
      if (!isUuid(signalId)) {
        res.status(400).json({ error: "signal_id_must_be_uuid" });
        return;
      }

      // Promotion must be idempotent, and "already promoted?" is a read followed by a
      // write — so two clicks (or two tabs) racing could both read "no finding" and both
      // insert, leaving the org with duplicate findings for one signal and a Brief item
      // that links to an arbitrary one of them. Serialize per (org, signal) for the rest
      // of this transaction. An advisory lock, not a unique index: the automated path may
      // already have created a finding for this signal, so a uniqueness constraint could
      // not be added to existing data without first proving no duplicates exist.
      // Legitimate advisory-lock escape (tenantContext.ts:44-53). createSavepointClient only
      // rewrites BEGIN/COMMIT/ROLLBACK into savepoints and passes every other statement
      // through, which is exactly what this needs: the lock must be held on the SAME
      // transaction as the check-and-insert below, and released when it commits. It
      // deliberately does NOT take the pgRaw hatch — a lock acquired on a different connection
      // than the write it guards would guard nothing. No tenant rewriting is required either:
      // the lock key embeds organizationId, so two orgs promoting the same GLOBAL signal never
      // contend with each other.
      // eslint-disable-next-line securelogic-local/no-unrewriteable-stmt-in-tenant-wrap -- advisory lock, see above
      await pg.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `finding_from_signal:${organizationId}:${signalId}`,
      ]);

      // Signal visibility. A signal is promotable only if it is GLOBAL (organization_id
      // IS NULL — the fan-out model: ingested once, read by every org) or owned by the
      // caller's org. Without the org check, any org could promote another org's private
      // signal and read its summary back out of the finding it created.
      const signalResult = await pg.query<{
        signal_type: string;
        severity: string;
        normalized_summary: string;
        affected_cve: string | null;
      }>(
        `SELECT signal_type, severity, normalized_summary, affected_cve
           FROM cyber_signals
          WHERE id = $1
            AND (organization_id IS NULL OR organization_id = $2)`,
        [signalId, organizationId]
      );

      const signal = signalResult.rows[0];
      if (!signal) {
        res.status(404).json({ error: "signal_not_found" });
        return;
      }

      // Already promoted? This is the SAME predicate ?intel_ref= resolves with, on
      // purpose: the Brief decides whether to offer "Create finding" or "Open decision"
      // by that query, so if the two disagreed the UI would offer to create a finding
      // that already exists. Both intelligence channels count — the legacy per-signal
      // finding AND an event-native one the pipeline may have produced.
      const existing = await pg.query<{ id: string }>(
        `SELECT f.id
           FROM findings f
          WHERE f.organization_id = $1
            AND (
              (f.source_type IN ('cyber_signal', 'signal') AND f.source_id = $2::uuid)
              OR (f.source_type = 'intelligence_event' AND f.source_id IN (
                    SELECT ies.event_id FROM intelligence_event_sources ies
                     WHERE ies.cyber_signal_id = $2::uuid))
            )
          ORDER BY f.created_at ASC
          LIMIT 1`,
        [organizationId, signalId]
      );

      if (existing.rows[0]) {
        // Not an error: the caller wanted a finding for this signal and there is one.
        // Hand back the SAME finding so a double-click lands in the same workspace.
        res.status(200).json({ finding: existing.rows[0], created: false });
        return;
      }

      // A promoted signal matched no registry entity (if it had, the ingestion path
      // would already have made this finding). Shape it through the SAME shared builder
      // that path uses, so one signal cannot read as two different findings depending on
      // who created it.
      const title = buildSignalFindingTitle({
        signalType: signal.signal_type,
        severity: signal.severity,
        affectedCve: signal.affected_cve,
        entity: null,
      });
      const domain = resolveSignalDomain(signal.signal_type, false, false);
      const priority = severityToPriority(signal.severity);
      const dueDate = await resolveSlaDueDate(organizationId, signal.severity);

      const inserted = await pg.query(
        `
        INSERT INTO findings (
          organization_id, assessment_id, source_type, source_id,
          title, description, severity, domain, priority, status, due_date
        )
        VALUES ($1, NULL, 'cyber_signal', $2::uuid, $3, $4, $5, $6, $7, 'open', $8)
        RETURNING id, title, description, severity, domain, priority, status,
                  source_type, source_id, due_date, created_at
        `,
        [
          organizationId,
          signalId,
          title,
          signal.normalized_summary,
          signal.severity,
          domain,
          priority,
          dueDate,
        ]
      );

      const finding = inserted.rows[0];

      // NOTE: cyber_signals.linked_finding_id is deliberately NOT written here. For a
      // GLOBAL signal that column is shared by every org, so writing this org's finding
      // id into it would publish one tenant's finding to all of them. The per-org link is
      // findings.source_id, which is what every reader (?intel_ref=) already uses.

      logger.info(
        { event: "finding_promoted_from_signal", findingId: finding.id, signalId, organizationId },
        "Finding promoted from signal"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: req.userId ?? null,
        eventType: "finding.promoted_from_signal",
        resourceType: "finding",
        resourceId: finding.id as string,
        payload: { signal_id: signalId, severity: signal.severity, domain },
        ipAddress: req.ip ?? null,
      });

      triggerFindingAlert({
        findingId: finding.id as string,
        organizationId,
        title: finding.title as string,
        severity: finding.severity as string,
        domain: (finding.domain as string | null) ?? null,
      });

      dispatchWebhookEvent({
        event_type: "finding.created",
        organization_id: organizationId,
        data: {
          id: finding.id,
          title: finding.title,
          severity: finding.severity,
          source_type: "cyber_signal",
          source_id: signalId,
        },
      });

      res.status(201).json({ finding, created: true });
    } catch (err) {
      logger.error({ err, event: "finding_promote_from_signal_failed" }, "Failed to promote signal");
      res.status(500).json({ error: "finding_promote_failed" });
    }
  })
);

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
      /** Set when this PATCH carries the finding OUT of closure (see the reopen block). */
      let reopening = false;

      // The legacy `status` axis is a COMPATIBILITY ENTRY POINT (ruling 2026-07-14). It no
      // longer force-writes closure inline: it DELEGATES to the canonical closure service,
      // which enforces the remediation gate, derives both axes, and writes the lifecycle +
      // audit records that the inline write used to swallow. It never touches
      // decision_state — a legacy caller cannot be assumed to have made a governance
      // decision, and fabricating one would undermine the whole governance model.
      //
      // Applied AFTER every other field is validated (below) but BEFORE any write, so a
      // refusal cannot leave a half-applied PATCH behind. See `legacyStatus`.
      let legacyStatus: string | null = null;
      if ("status" in body) {
        const status = body["status"];
        if (!isNonEmptyString(status) || !VALID_PATCH_STATUSES.has(status)) {
          res.status(400).json({
            error: "invalid_status",
            allowed: [...VALID_PATCH_STATUSES]
          });
          return;
        }
        legacyStatus = status;
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
        // P0 (2026-07-15): when the signed risk-acceptance workflow is live, `accepted_risk`
        // is the OUTPUT of that workflow (approve by a second authorized user), never a
        // direct decision write. Refuse the one-click side door before any read, so a
        // governance decision can never be fabricated as a bare label. Flag OFF (prod):
        // directRiskAcceptanceBlocked() is false and this branch is byte-identical.
        if (directRiskAcceptanceBlocked({ decisionState: ds })) {
          res.status(409).json({ ...USE_RISK_ACCEPTANCE_WORKFLOW_ERROR, finding_id: findingId });
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
        // Separation of duties on closure (spec §7, org-enforced): resolve the
        // org policy and the remediator (actor of the latest operational→
        // remediated lifecycle event) in this same tenant transaction. Only
        // needed for the close target; resolved unconditionally-cheaply here
        // because the machine ignores it for every other transition.
        const sodRow = await pg.query<{
          enforced: boolean;
          remediator: string | null;
          action_count: string;
        }>(
          `SELECT
             COALESCE((SELECT s.require_finding_closure_sod FROM risk_settings s
                        WHERE s.organization_id = $1), FALSE) AS enforced,
             (SELECT e.actor_user_id FROM finding_lifecycle_events e
               WHERE e.organization_id = $1 AND e.finding_id = $2
                 AND e.axis = 'operational' AND e.to_state = 'remediated'
               ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS remediator,
             (SELECT COUNT(*) FROM actions
               WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2)
               AS action_count`,
          [organizationId, findingId]
        );
        decisionTransition = evaluateFindingDecisionTransition(
          currentRow.decision_state,
          ds,
          {
            operationalStatus: currentRow.operational_status,
            sod: {
              enforced: sodRow.rows[0]?.enforced === true,
              actorUserId: (req.userId as string | undefined) ?? null,
              remediatorUserId: sodRow.rows[0]?.remediator ?? null,
            },
            // A Finding with NO Actions has no incomplete remediation, so an explicit
            // resolution may close it without first inventing a fake remediation item to
            // complete (ruling 2026-07-14). 'remediated' is unreachable for such a Finding
            // by construction, so demanding it made false positives unclosable.
            hasRemediation: parseInt(sodRow.rows[0]?.action_count ?? "0", 10) > 0,
          }
        );
        if (!decisionTransition.allowed) {
          // ONE error contract for "remediation is not complete", whichever axis asked.
          // The governance axis used to answer with its own internal reason string and no
          // count, so a client had to parse two different refusals for one rule. With the
          // gate on it now answers with the canonical code and the number of blocking
          // Actions — the same body the legacy axis returns.
          if (
            findingClosureGateEnabled() &&
            decisionTransition.reason === "close_requires_remediated_or_accepted_risk"
          ) {
            const decision = evaluateFindingClosure(
              await loadClosureBlockers(pg, organizationId, findingId, {
                acceptanceEnabled: riskAcceptanceEnabled(),
              })
            );
            if (!decision.allowed) {
              res.status(decision.httpStatus).json(decision.body);
              return;
            }
          }
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

        // REOPEN must clear the closure on BOTH axes, here, in this statement.
        //
        // After a close, decision_state='resolved' AND legacy status='closed' —
        // both say closed. Clearing only the governance axis would leave the legacy
        // one terminal, the compat bridge would re-derive `closed` from it, and the
        // finding would spring shut again the instant it was reopened. (This is not
        // hypothetical: it is exactly what the isolation test caught.)
        //
        // Both are set provisionally to 'open' — a legal, non-contradicting pair —
        // and the recompute below then derives the finding's REAL state from its
        // Actions and projects the legacy axis to match (§3).
        if (decisionTransition.transition === "reopen") {
          reopening = true;
          updates.push(
            `status = CASE WHEN findings.status IN ('closed', 'accepted')
                           THEN 'open' ELSE findings.status END`
          );
          updates.push(
            `operational_status = CASE WHEN findings.operational_status = 'closed'
                                       THEN 'open' ELSE findings.operational_status END`
          );
        }
      }

      if (updates.length === 0 && legacyStatus === null) {
        res.status(400).json({
          error: "no_updateable_fields",
          updatable: ["status", "priority", "owner_user_id", "due_date"]
        });
        return;
      }

      const actor = {
        actorUserId: (req.userId as string | undefined) ?? null,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
      };

      // THE LEGACY AXIS, THROUGH THE CANONICAL SERVICE — first, and before any other field
      // is written. A refused close therefore leaves the whole PATCH unapplied: the
      // priority or owner that rode along in the same body is not written either. That is
      // what "no partial state if rejected" has to mean when one request carries several
      // fields.
      let legacyOutcome: Awaited<ReturnType<typeof applyLegacyStatusTransition>> | null = null;
      if (legacyStatus !== null) {
        legacyOutcome = await applyLegacyStatusTransition({
          organizationId,
          findingId,
          newStatus: legacyStatus,
          actor,
        });

        if (legacyOutcome.kind === "not_found") {
          res.status(404).json({ error: "finding_not_found" });
          return;
        }
        if (legacyOutcome.kind === "refused") {
          res.status(legacyOutcome.httpStatus).json(legacyOutcome.body);
          return;
        }
        if (legacyOutcome.changed && legacyOutcome.auditEvent) {
          // The audit record the inline write used to swallow. `closure_path` and the
          // unchanged decision_state are recorded explicitly so the trail shows that
          // operational closure occurred, that no governance resolution was inferred, and
          // that no decision_state transition was fabricated.
          writeAuditEvent({
            organizationId,
            actorApiKeyId: actor.actorApiKeyId,
            actorUserId: actor.actorUserId,
            eventType: legacyOutcome.auditEvent,
            resourceType: "finding",
            resourceId: findingId,
            payload: {
              from: legacyOutcome.fromState,
              to: legacyOutcome.toState,
              legacy_status: legacyStatus,
              closure_path: "legacy_compat",
              governance_resolution_inferred: false,
              decision_state: legacyOutcome.decisionState,
            },
            ipAddress: req.ip ?? null,
          });
        }
      }

      // Everything EXCEPT the legacy axis (priority, owner, due date, decision_state).
      let result: { rows: any[]; rowCount: number | null };
      if (updates.length > 0) {
        values.push(findingId, organizationId);
        const idParam = values.length - 1;
        const orgParam = values.length;

        result = await pg.query(
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
      } else {
        // status-only PATCH: the service already wrote it. Re-read for the response.
        result = await pg.query(
          `SELECT id, organization_id, source_type, title, severity,
                  domain, priority, status, decision_state, operational_status,
                  owner_user_id, due_date, updated_at
             FROM findings WHERE id = $1 AND organization_id = $2`,
          [findingId, organizationId]
        );
      }

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

      // Re-derive the authoritative axis from the state this PATCH just wrote,
      // in the SAME tenant transaction. Two things depend on it:
      //
      //   CLOSE   a governance close writes decision_state='resolved' and nothing
      //           else; without this recompute the finding would stay
      //           operational_status='remediated' — i.e. still ACTIVE — and the
      //           whole ruling would be inert. The recompute derives 'closed'
      //           (rule 1) and projects the legacy axis to match.
      //   REOPEN  the provisional 'open' written above is refined to the finding's
      //           REAL state (in_progress / remediated / open) from its Actions.
      //
      // Idempotent: a PATCH that touched neither axis derives the same state and
      // writes nothing.
      const reconciled = await recomputeFindingOperationalStatus(
        organizationId,
        findingId,
        {
          actorUserId: (req.userId as string | undefined) ?? null,
          actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        },
        // On a governance reopen the legacy axis was cleared to a provisional
        // 'open'; re-derive it from the finding's REAL state so a reopened,
        // already-remediated finding reads 'in_progress' (§3) and not 'open'.
        { projectLegacy: reopening }
      );
      if (reconciled.changed && reconciled.auditEvent) {
        writeAuditEvent({
          organizationId,
          actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
          actorUserId: req.userId ?? null,
          eventType: reconciled.auditEvent,
          resourceType: "finding",
          resourceId: findingId,
          payload: { from: reconciled.fromState ?? null, to: reconciled.toState ?? null },
          ipAddress: req.ip ?? null,
        });
      }

      // The UPDATE's RETURNING predates the recompute, so on a close/reopen it
      // still carries the pre-reconcile axes. Re-read, or the caller would be told
      // its close left the finding 'remediated' — the API answering with a state
      // the database no longer holds.
      let row = result.rows[0];
      if (reconciled.changed) {
        const refreshed = await pg.query(
          `SELECT id, organization_id, source_type, title, severity,
                  domain, priority, status, decision_state, operational_status,
                  owner_user_id, due_date, updated_at
             FROM findings WHERE id = $1 AND organization_id = $2`,
          [findingId, organizationId]
        );
        if (refreshed.rows[0]) row = refreshed.rows[0];
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: req.userId ?? null,
        eventType: "finding.status_changed",
        resourceType: "finding",
        resourceId: row.id as string,
        payload: {
          // The full mutation set — owner and due-date changes were previously
          // invisible in the audit payload (workflow-audit gap).
          status: row.status ?? null,
          operational_status: row.operational_status ?? null,
          priority: row.priority ?? null,
          decision_state: row.decision_state ?? null,
          owner_user_id: row.owner_user_id ?? null,
          due_date: row.due_date ?? null,
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
          id: row.id,
          status: row.status,
          operational_status: row.operational_status,
          updated_at: row.updated_at,
        },
      }).catch(() => {});

      res.status(200).json({ finding: row });
    } catch (err) {
      logger.error(
        { event: "finding_patch_failed", err },
        "PATCH /api/findings/:id failed"
      );
      res.status(500).json({ error: "finding_patch_failed" });
    }
  })
);

/* =========================================================
   POST /api/findings/bulk
   Bounded bulk operations over findings — the ops center is only operable at
   enterprise scale if 200 unassigned findings do not require 200 round trips.

     { "op": "assign", "ids": [...], "owner_user_id": "<uuid>" | null }
     { "op": "decide", "ids": [...], "decision_state": "<state>" }

   Contract:
   - ids: 1..100 unique UUIDs, all org-scoped (foreign ids report not_found —
     never touched, never enumerable).
   - assign: one set-based UPDATE; reports per-id ok/not_found.
   - decide: EVERY finding is evaluated INDIVIDUALLY through the same guarded
     state machine as single PATCH (close guard, evidence gate via derived
     state, separation of duties) — bulk is a convenience, never a bypass.
     Guard refusals are per-id results, not errors. Flag-gated like PATCH.
   - The whole request is one tenant transaction (asTenant): DB failure rolls
     back everything; guard refusals do not.
   ========================================================= */

const BULK_MAX_IDS = 100;

router.post(
  "/findings/bulk",
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

      const body =
        req.body != null && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};

      const op = body["op"];
      if (op !== "assign" && op !== "decide") {
        res.status(400).json({ error: "invalid_bulk_op", allowed: ["assign", "decide"] });
        return;
      }

      const rawIds = body["ids"];
      if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > BULK_MAX_IDS) {
        res.status(400).json({ error: "ids_must_be_1_to_100" });
        return;
      }
      const ids = [...new Set(rawIds.map((v) => String(v)))];
      if (!ids.every((id) => isUuid(id))) {
        res.status(400).json({ error: "ids_must_be_uuids" });
        return;
      }

      const actorUserId = (req.userId as string | undefined) ?? null;
      const actorApiKeyId = ((req as any).apiKey?.id as string) ?? null;

      if (op === "assign") {
        const ownerId = body["owner_user_id"];
        if (ownerId !== null && !isUuid(ownerId)) {
          res.status(400).json({ error: "owner_user_id_must_be_uuid_or_null" });
          return;
        }
        const updated = await pg.query<{ id: string }>(
          `UPDATE findings SET owner_user_id = $1, updated_at = NOW()
            WHERE organization_id = $2 AND id = ANY($3::uuid[])
            RETURNING id`,
          [ownerId ?? null, organizationId, ids]
        );
        const updatedSet = new Set(updated.rows.map((r) => r.id));
        writeAuditEvent({
          organizationId,
          actorApiKeyId,
          actorUserId,
          eventType: "finding.bulk_assigned",
          resourceType: "finding",
          resourceId: null,
          payload: {
            owner_user_id: (ownerId as string | null) ?? null,
            requested: ids.length,
            updated: updatedSet.size,
            finding_ids: [...updatedSet],
          },
          ipAddress: req.ip ?? null,
        });
        res.status(200).json({
          op,
          requested: ids.length,
          updated: updatedSet.size,
          results: ids.map((id) => ({ id, ok: updatedSet.has(id), ...(updatedSet.has(id) ? {} : { reason: "not_found" }) })),
        });
        return;
      }

      // op === "decide" — flag-gated exactly like the single PATCH decision write.
      if (process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED !== "true") {
        res.status(404).json({ error: "findings_bulk_decide_not_found" });
        return;
      }
      const ds = body["decision_state"];
      if (!isNonEmptyString(ds) || !VALID_DECISION_STATES.has(ds)) {
        res.status(400).json({ error: "invalid_decision_state", allowed: [...VALID_DECISION_STATES] });
        return;
      }
      // P0 (2026-07-15): the same side-door guard as the single PATCH. A bulk decide can no
      // more fabricate an acceptance than one-at-a-time — each finding needs its own signed
      // proposal + independent approval. Refuse the whole op rather than silently accepting
      // a subset. Flag OFF (prod): not reached (bulk decide is behind DECISION_WORKSPACE).
      if (directRiskAcceptanceBlocked({ decisionState: ds })) {
        res.status(409).json(USE_RISK_ACCEPTANCE_WORKFLOW_ERROR);
        return;
      }

      // Org SoD policy resolved once; the remediator is per-finding.
      const sodPolicy = await pg.query<{ enforced: boolean }>(
        `SELECT COALESCE((SELECT s.require_finding_closure_sod FROM risk_settings s
                           WHERE s.organization_id = $1), FALSE) AS enforced`,
        [organizationId]
      );
      const sodEnforced = sodPolicy.rows[0]?.enforced === true;

      const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
      let updatedCount = 0;

      for (const findingId of ids) {
        const current = await pg.query<{ decision_state: string; operational_status: string }>(
          `SELECT decision_state, operational_status FROM findings
            WHERE id = $1 AND organization_id = $2
            FOR UPDATE`,
          [findingId, organizationId]
        );
        const currentRow = current.rows[0];
        if (!currentRow) {
          results.push({ id: findingId, ok: false, reason: "not_found" });
          continue;
        }
        const remediatorRow = await pg.query<{
          remediator: string | null;
          action_count: string;
        }>(
          `SELECT
             (SELECT e.actor_user_id FROM finding_lifecycle_events e
               WHERE e.organization_id = $1 AND e.finding_id = $2
                 AND e.axis = 'operational' AND e.to_state = 'remediated'
               ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS remediator,
             (SELECT COUNT(*) FROM actions
               WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2)
               AS action_count`,
          [organizationId, findingId]
        );
        const decision = evaluateFindingDecisionTransition(currentRow.decision_state, ds, {
          operationalStatus: currentRow.operational_status,
          sod: {
            enforced: sodEnforced,
            actorUserId,
            remediatorUserId: remediatorRow.rows[0]?.remediator ?? null,
          },
          // Same rule as the single PATCH: no remediation to complete ⇒ nothing incomplete.
          hasRemediation: parseInt(remediatorRow.rows[0]?.action_count ?? "0", 10) > 0,
        });
        if (!decision.allowed) {
          results.push({ id: findingId, ok: false, reason: decision.reason ?? "invalid_decision_transition" });
          continue;
        }
        if (decision.noop) {
          results.push({ id: findingId, ok: true });
          continue;
        }
        // REOPEN must clear the closure on BOTH axes here, in this statement — exactly as
        // the single PATCH does. Clearing only the governance axis would leave the legacy
        // one terminal, the compat bridge would re-derive 'closed' from it, and the Finding
        // would spring shut again the instant it was reopened. Bulk was missing this.
        await pg.query(
          decision.transition === "reopen"
            ? `UPDATE findings
                  SET decision_state = $1,
                      status = CASE WHEN status IN ('closed','accepted') THEN 'open'
                                    ELSE status END,
                      operational_status = CASE WHEN operational_status = 'closed' THEN 'open'
                                                ELSE operational_status END,
                      updated_at = NOW()
                WHERE id = $2 AND organization_id = $3`
            : `UPDATE findings SET decision_state = $1, updated_at = NOW()
                WHERE id = $2 AND organization_id = $3`,
          [ds, findingId, organizationId]
        );
        await writeFindingLifecycleEvent({
          organizationId,
          findingId,
          axis: "decision",
          fromState: decision.fromState ?? null,
          toState: decision.toState as string,
          transition: decision.transition!,
          actor: { actorUserId, actorApiKeyId },
        });
        writeAuditEvent({
          organizationId,
          actorApiKeyId,
          actorUserId,
          eventType: decision.auditEvent ?? "finding.decision_changed",
          resourceType: "finding",
          resourceId: findingId,
          payload: { from: decision.fromState ?? null, to: decision.toState ?? null, bulk: true },
          ipAddress: req.ip ?? null,
        });

        // Re-derive the authoritative axis — the step this loop was MISSING.
        //
        // A bulk 'decide' wrote decision_state and nothing else, so a bulk Resolve left the
        // Finding at operational_status='remediated' — i.e. still ACTIVE, still on every
        // dashboard — while its governance axis said resolved. The single PATCH has always
        // recomputed (that is what makes the ruling non-inert); bulk silently did not, so
        // the two paths disagreed about what "close" means. Same canonical recompute, same
        // tenant transaction, and projectLegacy on a reopen for the same reason the single
        // path needs it.
        const reconciled = await recomputeFindingOperationalStatus(
          organizationId,
          findingId,
          { actorUserId, actorApiKeyId },
          { projectLegacy: decision.transition === "reopen" }
        );
        if (reconciled.changed && reconciled.auditEvent) {
          writeAuditEvent({
            organizationId,
            actorApiKeyId,
            actorUserId,
            eventType: reconciled.auditEvent,
            resourceType: "finding",
            resourceId: findingId,
            payload: {
              from: reconciled.fromState ?? null,
              to: reconciled.toState ?? null,
              bulk: true,
            },
            ipAddress: req.ip ?? null,
          });
        }

        updatedCount++;
        results.push({ id: findingId, ok: true });
      }

      res.status(200).json({ op, requested: ids.length, updated: updatedCount, results });
    } catch (err) {
      logger.error({ event: "findings_bulk_failed", err }, "POST /api/findings/bulk failed");
      res.status(500).json({ error: "findings_bulk_failed" });
    }
  })
);

export default router;
