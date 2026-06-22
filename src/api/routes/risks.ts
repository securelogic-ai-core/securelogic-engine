/**
 * risks.ts — Risk register primitives API
 *
 * A risk is an org-scoped, mutable record capturing an identified risk
 * with its likelihood, impact, rating, treatment, and lifecycle status.
 *
 * risk_rating is stored explicitly. Computation from likelihood × impact
 * is a future engine concern, not this package.
 *
 * Optional source linkage (source_type + source_id) records where the
 * risk was identified from. Both fields must be present together or absent.
 *
 * Routes:
 *   POST  /api/risks        — create risk record
 *   GET   /api/risks        — list (org-scoped, filterable, cursor paginated)
 *   GET   /api/risks/:id    — get single risk record
 *   PATCH /api/risks/:id    — partial update
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import {
  validateRiskCreate,
  validateRiskUpdate,
  validateRiskListQuery
} from "../lib/riskValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { dispatchWebhookEvent } from "../lib/webhookDispatcher.js";
import { resolveOwnerUserSameOrg } from "../lib/ownerUserResolver.js";
import { resolveCadenceDays } from "../lib/riskCadence.js";

const router = Router();

// ---------------------------------------------------------------------------
// Pure helper — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Aggregate risk register DB rows into a summary object.
 * All canonical status and rating keys are always present; missing values default to 0.
 * Exported for unit testing without a live database.
 */
export function buildRiskSummary(
  byStatusRows: ReadonlyArray<{ status: string; count: string }>,
  byRatingRows: ReadonlyArray<{ risk_rating: string; count: string }>,
  byDomainRows: ReadonlyArray<{ domain: string; count: string }>,
  byInherentRatingRows: ReadonlyArray<{ inherent_rating: string; count: string }> = [],
  byResidualRatingRows: ReadonlyArray<{ residual_rating: string; count: string }> = []
): {
  total: number;
  open_critical_count: number;
  by_status: Record<string, number>;
  by_risk_rating: Record<string, number>;
  by_inherent_rating: Record<string, number>;
  by_residual_rating: Record<string, number>;
  by_domain: Record<string, number>;
} {
  const by_status: Record<string, number> = {
    open: 0,
    accepted: 0,
    mitigated: 0,
    closed: 0,
    transferred: 0
  };
  for (const row of byStatusRows) {
    if (row.status in by_status) {
      by_status[row.status] = parseInt(row.count, 10);
    }
  }

  // Legacy `by_risk_rating` kept for backwards compatibility — it
  // mirrors `by_residual_rating` after Phase 1 backfill (legacy =
  // residual on every write). Existing consumers (dashboard tile,
  // /risks page summary cards) continue to read the legacy key
  // until they migrate.
  const by_risk_rating: Record<string, number> = {
    Critical: 0,
    High: 0,
    Moderate: 0,
    Low: 0
  };
  for (const row of byRatingRows) {
    if (row.risk_rating in by_risk_rating) {
      by_risk_rating[row.risk_rating] = parseInt(row.count, 10);
    }
  }

  const by_inherent_rating: Record<string, number> = {
    Critical: 0,
    High: 0,
    Moderate: 0,
    Low: 0
  };
  for (const row of byInherentRatingRows) {
    if (row.inherent_rating in by_inherent_rating) {
      by_inherent_rating[row.inherent_rating] = parseInt(row.count, 10);
    }
  }

  const by_residual_rating: Record<string, number> = {
    Critical: 0,
    High: 0,
    Moderate: 0,
    Low: 0
  };
  for (const row of byResidualRatingRows) {
    if (row.residual_rating in by_residual_rating) {
      by_residual_rating[row.residual_rating] = parseInt(row.count, 10);
    }
  }

  const by_domain: Record<string, number> = {};
  for (const row of byDomainRows) {
    by_domain[row.domain] = parseInt(row.count, 10);
  }

  const total = Object.values(by_status).reduce((s, n) => s + n, 0);
  // open_critical_count reads RESIDUAL per Decision §3 — the
  // post-controls "what's actually critical right now" count is what
  // dashboard callouts display.
  //
  // Reading by_risk_rating would also work TODAY because Phase 1
  // backfill made legacy = residual on every existing row and the
  // POST/PATCH handlers preserve that invariant on every write. But
  // coupling open_critical_count to the legacy column creates a
  // hidden dependency: if a future package decouples legacy from
  // residual (e.g., a breaking-change major version that drops the
  // legacy column, or a new write path that fails to sync them),
  // this number silently becomes wrong. Read residual directly so
  // the semantic is explicit at the read site.
  const open_critical_count = by_residual_rating["Critical"] ?? 0;

  return {
    total,
    open_critical_count,
    by_status,
    by_risk_rating,
    by_inherent_rating,
    by_residual_rating,
    by_domain
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

const RISK_SELECT = `
  id,
  organization_id,
  title,
  description,
  domain,
  likelihood,
  impact,
  risk_rating,
  inherent_likelihood,
  inherent_impact,
  inherent_rating,
  residual_likelihood,
  residual_impact,
  residual_rating,
  status,
  treatment,
  owner,
  owner_user_id,
  due_date,
  source_type,
  source_id,
  last_reviewed_at,
  next_review_due,
  review_cadence_days,
  (
    next_review_due IS NOT NULL
    AND next_review_due < CURRENT_DATE
  ) AS is_overdue,
  created_at,
  updated_at
`;

// Mutable columns the PATCH handler may change. Used by the audit-log
// payload to build a per-field { before, after } diff (RR-3 fix 1.2).
// Keep in sync with the addField() calls in the PATCH handler.
//
// NOTE: last_reviewed_at and next_review_due are NOT in this list —
// they are written exclusively by POST /api/risks/:id/review (RR-5),
// which emits a dedicated `risk.reviewed` audit event. Allowing them
// in PATCH would split the review-history surface across two event
// types; keeping them out of PATCH keeps the RR-3 history clean.
const DIFFABLE_FIELDS = [
  "title",
  "description",
  "domain",
  "likelihood",
  "impact",
  "risk_rating",
  "inherent_likelihood",
  "inherent_impact",
  "inherent_rating",
  "residual_likelihood",
  "residual_impact",
  "residual_rating",
  "status",
  "treatment",
  "owner",
  "owner_user_id",
  "due_date",
  "source_type",
  "source_id",
  // RR-5: per-risk override of the org cadence policy
  "review_cadence_days"
] as const;

/* =========================================================
   POST /api/risks
   Create a risk record.

   SOURCE LINKAGE NOTE:
   source_type and source_id are unverified provenance metadata.
   They record where the risk was identified from but are not
   FK-verified against any source table — source_type is a
   free-form string and can reference findings, assessments,
   signals, or manual entries. The DB enforces co-presence
   (risk_source_consistency CHECK) but not existence or org scope.
   ========================================================= */

router.post(
  "/risks",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateRiskCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      // If owner_user_id is supplied, verify it belongs to this org and
      // capture the user's name so we can denormalize it into the legacy
      // `owner` TEXT column. This keeps display safe if the user is
      // later deleted (FK clears, text column still renders).
      let ownerText: string | null = input.owner;
      if (input.owner_user_id !== null) {
        const resolved = await resolveOwnerUserSameOrg(
          pg,
          input.owner_user_id,
          organizationId
        );
        if ("error" in resolved) {
          res.status(400).json({
            error: "invalid_owner_user_id",
            detail: "User is not a member of this organization."
          });
          return;
        }
        // Caller may have supplied an explicit `owner` text alongside
        // owner_user_id. If they did, respect it; otherwise denormalize
        // from the resolved user's name.
        if (ownerText === null) {
          ownerText = resolved.name;
        }
      }

      // Legacy `likelihood / impact / risk_rating` columns are written
      // alongside the new fields. Per Decision §5 (webhook backwards
      // compatibility), legacy = residual on every write so existing
      // webhook consumers continue to receive a meaningful risk_rating
      // value derived from the post-controls assessment.
      //
      // The validator requires all 9 rating fields explicitly (Phase 1).
      // The legacy values come from input.likelihood/impact/risk_rating,
      // not from input.residual_* — keeping them independent allows a
      // caller to send legacy = inherent if they have a reason to,
      // though the documented intent is legacy = residual.
      const result = await pg.query(
        `
        INSERT INTO risks (
          organization_id,
          title,
          description,
          domain,
          likelihood,
          impact,
          risk_rating,
          inherent_likelihood,
          inherent_impact,
          inherent_rating,
          residual_likelihood,
          residual_impact,
          residual_rating,
          status,
          treatment,
          owner,
          owner_user_id,
          due_date,
          source_type,
          source_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        RETURNING ${RISK_SELECT}
        `,
        [
          organizationId,
          input.title,
          input.description ?? null,
          input.domain,
          input.likelihood,
          input.impact,
          input.risk_rating,
          input.inherent_likelihood,
          input.inherent_impact,
          input.inherent_rating,
          input.residual_likelihood,
          input.residual_impact,
          input.residual_rating,
          input.status,
          input.treatment ?? null,
          ownerText,
          input.owner_user_id ?? null,
          input.due_date ?? null,
          input.source_type ?? null,
          input.source_id ?? null
        ]
      );

      const risk = result.rows[0];

      logger.info(
        {
          event: "risk_created",
          organizationId,
          riskId: risk.id,
          domain: input.domain,
          riskRating: input.risk_rating,
          inherentRating: input.inherent_rating,
          residualRating: input.residual_rating
        },
        "Risk record created"
      );

      // Audit payload includes before/after for both ratings. On
      // create, "before" is null (the row didn't exist); "after" is
      // the input values. Item 2 from Decision §11 scope expansion.
      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: req.userId ?? null,
        eventType: "risk.created",
        resourceType: "risk",
        resourceId: risk.id as string,
        payload: {
          domain: input.domain,
          risk_rating: input.risk_rating,
          inherent_rating: { before: null, after: input.inherent_rating },
          residual_rating: { before: null, after: input.residual_rating },
          status: input.status
        },
        ipAddress: req.ip ?? null
      });

      // Webhook payload retains `risk_rating` for backwards compat
      // (Decision §5). Adds inherent_rating and residual_rating as
      // first-class fields. risk_rating === residual_rating by
      // contract; consumers reading the legacy field continue to work.
      dispatchWebhookEvent({
        event_type: "risk.created",
        organization_id: organizationId,
        data: {
          id: risk.id,
          title: risk.title,
          risk_rating: risk.residual_rating,
          inherent_rating: risk.inherent_rating,
          residual_rating: risk.residual_rating,
          domain: risk.domain,
        },
      }).catch(() => {});

      res.status(201).json({ risk });
    } catch (err) {
      logger.error(
        { event: "risk_create_failed", err },
        "POST /api/risks failed"
      );
      res.status(500).json({ error: "risk_create_failed" });
    }
  })
);

/* =========================================================
   GET /api/risks
   List risks for the org.
   Supports status, domain, risk_rating filters.
   Cursor paginated.
   ========================================================= */

router.get(
  "/risks",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateRiskListQuery(req.query);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      if (input.status !== null) {
        params.push(input.status);
        conditions.push(`status = $${params.length}`);
      }

      if (input.domain !== null) {
        params.push(input.domain);
        conditions.push(`domain = $${params.length}`);
      }

      if (input.risk_rating !== null) {
        params.push(input.risk_rating);
        conditions.push(`risk_rating = $${params.length}`);
      }

      // RR-5: review_status filter — three buckets relative to today.
      //   overdue:    next_review_due < CURRENT_DATE
      //   due_soon:   CURRENT_DATE <= next_review_due < CURRENT_DATE + 14 days
      //   up_to_date: next_review_due IS NULL OR next_review_due >= CURRENT_DATE + 14 days
      // No params pushed — the dates are evaluated server-side.
      if (input.review_status === "overdue") {
        conditions.push(`(next_review_due IS NOT NULL AND next_review_due < CURRENT_DATE)`);
      } else if (input.review_status === "due_soon") {
        conditions.push(
          `(next_review_due IS NOT NULL AND next_review_due >= CURRENT_DATE AND next_review_due < (CURRENT_DATE + INTERVAL '14 days'))`
        );
      } else if (input.review_status === "up_to_date") {
        conditions.push(
          `(next_review_due IS NULL OR next_review_due >= (CURRENT_DATE + INTERVAL '14 days'))`
        );
      }

      if (input.before_created_at !== null && input.before_id !== null) {
        params.push(input.before_created_at, input.before_id);
        const ci = params.length - 1;
        conditions.push(
          `(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(input.limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT ${RISK_SELECT}
        FROM risks
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const risks = result.rows;
      const last = risks.length > 0 ? risks[risks.length - 1] : null;

      res.status(200).json({
        count: risks.length,
        limit: input.limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        risks
      });
    } catch (err) {
      logger.error(
        { event: "risk_list_failed", err },
        "GET /api/risks failed"
      );
      res.status(500).json({ error: "risk_list_failed" });
    }
  })
);

/* =========================================================
   GET /api/risks/summary
   Aggregate counts for the org's risk register:
   - by_status: count per lifecycle status
   - by_risk_rating: count per rating
   - by_domain: count per domain value
   - open_critical_count: shortcut for dashboard callouts
   ========================================================= */

router.get(
  "/risks/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      // A04-G1 γ.1 — serialized (was Promise.all). Under the asTenant wrap all
      // six aggregates run on the SINGLE per-request tenant client, which cannot
      // execute concurrent queries (the item-5 landmine). Sequential awaits keep
      // one query in flight at a time. Query text unchanged; only the result
      // binding changed from array-destructure to six consts. See design §2.1(i).
      const byStatusResult = await pg.query<{ status: string; count: string }>(
        `
        SELECT status, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
        GROUP BY status
        `,
        [organizationId]
      );
      const byRatingResult = await pg.query<{ risk_rating: string; count: string }>(
        `
        SELECT risk_rating, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
        GROUP BY risk_rating
        `,
        [organizationId]
      );
      const byDomainResult = await pg.query<{ domain: string; count: string }>(
        `
        SELECT domain, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
        GROUP BY domain
        ORDER BY count DESC, domain ASC
        `,
        [organizationId]
      );
      const byInherentRatingResult = await pg.query<{ inherent_rating: string; count: string }>(
        `
        SELECT inherent_rating, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
          AND inherent_rating IS NOT NULL
        GROUP BY inherent_rating
        `,
        [organizationId]
      );
      const byResidualRatingResult = await pg.query<{ residual_rating: string; count: string }>(
        `
        SELECT residual_rating, COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
          AND residual_rating IS NOT NULL
        GROUP BY residual_rating
        `,
        [organizationId]
      );
      // RR-5: count of risks whose review is overdue right now. Single
      // scalar — feeds the "Overdue Reviews" stat tile on the risk list
      // page. Same predicate as the review_status='overdue' list filter
      // and the is_overdue computed column in RISK_SELECT.
      const overdueReviewResult = await pg.query<{ count: string }>(
        `
        SELECT COUNT(*)::text AS count
        FROM risks
        WHERE organization_id = $1
          AND next_review_due IS NOT NULL
          AND next_review_due < CURRENT_DATE
        `,
        [organizationId]
      );

      const summary = buildRiskSummary(
        byStatusResult.rows,
        byRatingResult.rows,
        byDomainResult.rows,
        byInherentRatingResult.rows,
        byResidualRatingResult.rows
      );

      const overdue_review_count = parseInt(
        overdueReviewResult.rows[0]?.count ?? "0",
        10
      );

      res.status(200).json({ ...summary, overdue_review_count });
    } catch (err) {
      logger.error(
        { event: "risk_summary_failed", err },
        "GET /api/risks/summary failed"
      );
      res.status(500).json({ error: "risk_summary_failed" });
    }
  })
);

/* =========================================================
   GET /api/risks/intelligence
   Returns open risks enriched with treatment counts and
   linked open finding counts. Ordered by risk_rating severity.
   Excludes closed and transferred risks.
   ========================================================= */

type RiskIntelligenceRow = {
  id: string;
  title: string;
  domain: string;
  risk_rating: string;
  inherent_rating: string | null;
  residual_rating: string | null;
  status: string;
  likelihood: string | null;
  owner: string | null;
  active_treatments: string;
  total_treatments: string;
  linked_findings: string;
};

/**
 * Map enriched risk rows into the intelligence list shape.
 * Parses string counts from DB aggregates to numbers.
 * Exported for unit testing without a live database.
 *
 * `risk_rating` stays in the response shape for backwards
 * compatibility (legacy column = residual after Phase 1 backfill).
 * `inherent_rating` and `residual_rating` are surfaced explicitly so
 * the frontend can show both on the detail page in Phase 3.
 */
export function buildRiskIntelligenceList(rows: ReadonlyArray<RiskIntelligenceRow>): Array<{
  id: string;
  title: string;
  domain: string;
  risk_rating: string;
  inherent_rating: string | null;
  residual_rating: string | null;
  status: string;
  likelihood: string | null;
  owner: string | null;
  active_treatments: number;
  total_treatments: number;
  linked_findings: number;
}> {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    domain: r.domain,
    risk_rating: r.risk_rating,
    inherent_rating: r.inherent_rating ?? null,
    residual_rating: r.residual_rating ?? null,
    status: r.status,
    likelihood: r.likelihood ?? null,
    owner: r.owner ?? null,
    active_treatments: parseInt(r.active_treatments, 10),
    total_treatments: parseInt(r.total_treatments, 10),
    linked_findings: parseInt(r.linked_findings, 10)
  }));
}

router.get(
  "/risks/intelligence",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      // ORDER BY residual_rating per Decision §4 — the post-controls
      // assessment is what stakeholders sort by when triaging open risks.
      // Critical residual surfaces at the top; ties broken by created_at.
      const result = await pg.query<RiskIntelligenceRow>(
        `
        SELECT
          r.id,
          r.title,
          r.domain,
          r.risk_rating,
          r.inherent_rating,
          r.residual_rating,
          r.status,
          r.likelihood,
          r.owner,
          COUNT(rt.id) FILTER (
            WHERE rt.status IN ('not_started', 'in_progress')
          )::text AS active_treatments,
          COUNT(rt.id)::text AS total_treatments,
          COUNT(f.id)::text AS linked_findings
        FROM risks r
        LEFT JOIN risk_treatments rt
          ON rt.risk_id = r.id
         AND rt.organization_id = $1
        LEFT JOIN findings f
          ON f.source_type = 'risk'
         AND f.source_id = r.id
         AND f.organization_id = $1
         AND f.status = 'open'
        WHERE r.organization_id = $1
          AND r.status NOT IN ('closed', 'transferred')
        GROUP BY r.id, r.title, r.domain, r.risk_rating, r.inherent_rating,
                 r.residual_rating, r.status, r.likelihood, r.owner
        ORDER BY
          CASE r.residual_rating
            WHEN 'Critical' THEN 1
            WHEN 'High'     THEN 2
            WHEN 'Moderate' THEN 3
            WHEN 'Low'      THEN 4
            ELSE 5
          END,
          r.created_at DESC
        `,
        [organizationId]
      );

      const risks = buildRiskIntelligenceList(result.rows);
      // Critical count uses residual per Decision §4 — the
      // post-controls "what's actually critical right now" count.
      const openCriticalCount = risks.filter((r) => r.residual_rating === "Critical").length;

      res.status(200).json({
        count: risks.length,
        open_critical_count: openCriticalCount,
        risks
      });
    } catch (err) {
      logger.error(
        { event: "risk_intelligence_failed", err },
        "GET /api/risks/intelligence failed"
      );
      res.status(500).json({ error: "risk_intelligence_failed" });
    }
  })
);

/* =========================================================
   GET /api/risks/:id
   Get a single risk record by id.
   Returns 404 if not found or belongs to a different org.
   ========================================================= */

router.get(
  "/risks/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const riskId = String(req.params.id ?? "").trim();
    if (!riskId) {
      res.status(400).json({ error: "risk_id_required" });
      return;
    }
    if (!isUuid(riskId)) {
      res.status(400).json({ error: "risk_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${RISK_SELECT}
        FROM risks
        WHERE id = $1
          AND organization_id = $2
        `,
        [riskId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "risk_not_found" });
        return;
      }

      res.status(200).json({ risk: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "risk_get_failed", err },
        "GET /api/risks/:id failed"
      );
      res.status(500).json({ error: "risk_get_failed" });
    }
  })
);

/* =========================================================
   GET /api/risks/:id/history
   Per-risk audit trail (RR-3). Returns security_audit_log
   events scoped to this risk plus its treatments, ordered
   newest first. Mirrors the field shape of GET /api/audit-log
   so the frontend can reuse the existing event renderer.

   Auth: same chain as the rest of the risk register
   (standard entitlement, no admin gate) — anyone who can
   read the risk can read its history.
   ========================================================= */

const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT     = 100;

function parseHistoryLimit(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), HISTORY_MAX_LIMIT);
}

function parseHistoryOffset(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

router.get(
  "/risks/:id/history",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const riskId = String(req.params.id ?? "").trim();
    if (!riskId) {
      res.status(400).json({ error: "risk_id_required" });
      return;
    }
    if (!isUuid(riskId)) {
      res.status(400).json({ error: "risk_id_must_be_uuid" });
      return;
    }

    const limit  = parseHistoryLimit(req.query.limit);
    const offset = parseHistoryOffset(req.query.offset);

    try {
      // Verify the risk exists in this org. Mirror the same check used
      // by GET /api/risks/:id so cross-org probes return 404, not an
      // empty events list (which would also leak existence by absence
      // of a 404).
      const ownership = await pg.query(
        `SELECT 1 FROM risks WHERE id = $1 AND organization_id = $2`,
        [riskId, organizationId]
      );
      if ((ownership.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "risk_not_found" });
        return;
      }

      // Four-resource scope: events on the risk itself, plus events on
      // any of its treatments, risk-control links (RR-4), and risk-
      // obligation links (RR-6). Link subqueries do NOT filter on
      // deleted_at — without that, .deleted events become invisible the
      // moment the link is soft-deleted, defeating the audit trail. The
      // treatment + link subqueries are org-scoped so a stale resource_id
      // from a different org cannot bleed in.
      // ORDER BY (created_at DESC, id DESC) matches GET /api/audit-log.
      // A04-G1 γ.1 — serialized (was eager `eventsPromise`/`countPromise` +
      // Promise.all). Under the asTenant wrap both queries share the SINGLE
      // per-request tenant client, which cannot run concurrent queries. The
      // eager promise variables are removed so the events query is issued and
      // settled before the count query starts. Query text unchanged. See §2.1(ii).
      const eventsResult = await pg.query(
        `
        SELECT
          sal.id,
          sal.event_type,
          sal.actor_user_id,
          u.email        AS actor_email,
          u.name         AS actor_name,
          sal.resource_type,
          sal.resource_id,
          sal.ip_address,
          sal.payload    AS metadata,
          sal.created_at
        FROM security_audit_log sal
        LEFT JOIN users u ON u.id = sal.actor_user_id
        WHERE sal.organization_id = $1
          AND (
            (sal.resource_type = 'risk' AND sal.resource_id = $2::uuid)
            OR
            (sal.resource_type = 'risk_treatment' AND sal.resource_id IN (
              SELECT id FROM risk_treatments
              WHERE risk_id = $2::uuid AND organization_id = $1
            ))
            OR
            (sal.resource_type = 'risk_control_link' AND sal.resource_id IN (
              SELECT id FROM risk_control_links
              WHERE risk_id = $2::uuid AND organization_id = $1
            ))
            OR
            (sal.resource_type = 'risk_obligation_link' AND sal.resource_id IN (
              SELECT id FROM risk_obligation_links
              WHERE risk_id = $2::uuid AND organization_id = $1
            ))
          )
        ORDER BY sal.created_at DESC, sal.id DESC
        LIMIT $3 OFFSET $4
        `,
        [organizationId, riskId, limit, offset]
      );

      const countResult = await pg.query<{ total: string }>(
        `
        SELECT COUNT(*)::text AS total
        FROM security_audit_log sal
        WHERE sal.organization_id = $1
          AND (
            (sal.resource_type = 'risk' AND sal.resource_id = $2::uuid)
            OR
            (sal.resource_type = 'risk_treatment' AND sal.resource_id IN (
              SELECT id FROM risk_treatments
              WHERE risk_id = $2::uuid AND organization_id = $1
            ))
            OR
            (sal.resource_type = 'risk_control_link' AND sal.resource_id IN (
              SELECT id FROM risk_control_links
              WHERE risk_id = $2::uuid AND organization_id = $1
            ))
            OR
            (sal.resource_type = 'risk_obligation_link' AND sal.resource_id IN (
              SELECT id FROM risk_obligation_links
              WHERE risk_id = $2::uuid AND organization_id = $1
            ))
          )
        `,
        [organizationId, riskId]
      );

      const total_count = parseInt(countResult.rows[0]?.total ?? "0", 10);

      res.status(200).json({
        events:      eventsResult.rows,
        total_count,
        limit,
        offset
      });
    } catch (err) {
      logger.error(
        { event: "risk_history_failed", err, riskId },
        "GET /api/risks/:id/history failed"
      );
      res.status(500).json({ error: "risk_history_failed" });
    }
  })
);

/* =========================================================
   POST /api/risks/:id/review
   RR-5 — Mark a risk as reviewed.

   Computes next_review_due from the effective cadence:
     1. risks.review_cadence_days (per-risk override)
     2. risk_settings.cadence_by_rating[risk.residual_rating] (org policy)
     3. DEFAULT_CADENCE_BY_RATING[risk.residual_rating]      (defaults)
     4. FALLBACK_DAYS                                        (broad sweep)
   See src/api/lib/riskCadence.ts → resolveCadenceDays().

   Body (all optional):
     reviewed_at?: ISO date — defaults to today (CURRENT_DATE)
     note?:        string<=500 — recorded in the audit payload only

   Audit event: risk.reviewed with payload
     { reviewed_at, next_review_due, cadence_days_used, source: 'manual', note? }
   The `source` field is currently always 'manual' (this endpoint is the
   only writer). Reserved enum value 'cadence_update' is for a future
   path that recomputes next_review_due when cadence_days changes.
   ========================================================= */

const ISO_DATE_RE_REVIEW = /^\d{4}-\d{2}-\d{2}$/;

router.post(
  "/risks/:id/review",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const riskId = String(req.params.id ?? "").trim();
    if (!isUuid(riskId)) {
      res.status(400).json({ error: "risk_id_must_be_uuid" });
      return;
    }

    // Inline body validation — single endpoint, two optional fields.
    const body =
      req.body !== null && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    let reviewedAtParam: string | null = null;
    if ("reviewed_at" in body && body.reviewed_at !== null && body.reviewed_at !== undefined) {
      if (typeof body.reviewed_at !== "string" || !ISO_DATE_RE_REVIEW.test(body.reviewed_at)) {
        res.status(400).json({ error: "reviewed_at_must_be_iso_date" });
        return;
      }
      reviewedAtParam = body.reviewed_at;
    }

    let note: string | null = null;
    if ("note" in body && body.note !== null && body.note !== undefined) {
      if (typeof body.note !== "string") {
        res.status(400).json({ error: "note_must_be_string" });
        return;
      }
      const raw = body.note.trim();
      if (raw.length > 500) {
        res.status(400).json({
          error: "note_too_long",
          detail: "note must be 500 characters or fewer"
        });
        return;
      }
      note = raw.length === 0 ? null : raw;
    }

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Lock the risk row + read what we need to compute the cadence:
      // residual_rating drives the policy lookup; review_cadence_days
      // is the per-risk override.
      const riskResult = await client.query<{
        id: string;
        residual_rating: string | null;
        review_cadence_days: number | null;
      }>(
        `SELECT id, residual_rating, review_cadence_days
           FROM risks
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [riskId, organizationId]
      );

      if ((riskResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "risk_not_found" });
        return;
      }

      const riskRow = riskResult.rows[0]!;

      // Fetch the org policy. Missing row → null → resolveCadenceDays
      // falls through to documented defaults.
      const policyResult = await client.query<{
        cadence_by_rating: Record<string, unknown> | null;
      }>(
        `SELECT cadence_by_rating
           FROM risk_settings
          WHERE organization_id = $1
          LIMIT 1`,
        [organizationId]
      );
      const policyRaw = policyResult.rows[0]?.cadence_by_rating ?? null;
      // Coerce to Record<string, number> for resolveCadenceDays —
      // values that aren't positive ints are filtered out. Same
      // discipline as buildEffectiveCadenceByRating in riskSettings.ts.
      let policy: Record<string, number> | null = null;
      if (policyRaw && typeof policyRaw === "object") {
        policy = {};
        for (const [k, v] of Object.entries(policyRaw)) {
          if (typeof v === "number" && Number.isInteger(v) && v > 0) {
            policy[k] = v;
          }
        }
      }

      const cadenceDaysUsed = resolveCadenceDays(
        riskRow.review_cadence_days,
        policy,
        riskRow.residual_rating
      );

      // Write last_reviewed_at and recompute next_review_due. When
      // reviewed_at is null we let Postgres fill in CURRENT_DATE; this
      // also makes the date-arithmetic time-zone-safe (server's TZ).
      const updateResult = await client.query<{
        last_reviewed_at: string;
        next_review_due: string;
      }>(
        `UPDATE risks
           SET last_reviewed_at = COALESCE($3::date, CURRENT_DATE),
               next_review_due  = COALESCE($3::date, CURRENT_DATE) + ($4 * INTERVAL '1 day'),
               updated_at       = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING last_reviewed_at, next_review_due`,
        [riskId, organizationId, reviewedAtParam, cadenceDaysUsed]
      );

      const updated = updateResult.rows[0]!;

      await client.query("COMMIT");

      logger.info(
        {
          event: "risk_reviewed",
          organizationId,
          riskId,
          cadenceDaysUsed,
          residualRating: riskRow.residual_rating
        },
        "Risk reviewed"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId:   req.userId ?? null,
        eventType:     "risk.reviewed",
        resourceType:  "risk",
        resourceId:    riskId,
        payload: {
          reviewed_at:        updated.last_reviewed_at,
          next_review_due:    updated.next_review_due,
          cadence_days_used:  cadenceDaysUsed,
          source:             "manual",
          ...(note ? { note } : {})
        },
        ipAddress: req.ip ?? null
      });

      // Return the full refreshed row so the client doesn't need a
      // second GET to refresh the cadence section.
      const fullResult = await pg.query(
        `SELECT ${RISK_SELECT} FROM risks WHERE id = $1 AND organization_id = $2`,
        [riskId, organizationId]
      );

      res.status(200).json({
        risk: fullResult.rows[0],
        cadence_days_used: cadenceDaysUsed
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      logger.error(
        { event: "risk_review_failed", err, riskId },
        "POST /api/risks/:id/review failed"
      );
      res.status(500).json({ error: "risk_review_failed" });
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   PATCH /api/risks/:id
   Partial update of a risk record.
   ========================================================= */

router.patch(
  "/risks/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const riskId = String(req.params.id ?? "").trim();
    if (!riskId) {
      res.status(400).json({ error: "risk_id_required" });
      return;
    }
    if (!isUuid(riskId)) {
      res.status(400).json({ error: "risk_id_must_be_uuid" });
      return;
    }

    const validated = validateRiskUpdate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Lock the row and capture BEFORE values for every column the
      // PATCH may change. Selecting RISK_SELECT lets the audit payload
      // emit a per-field { before, after } diff for any mutable column
      // (RR-3 fix 1.2) — not just inherent/residual rating as before.
      const existingResult = await client.query<Record<string, unknown> & {
        id: string;
        inherent_rating: string | null;
        residual_rating: string | null;
      }>(
        `SELECT ${RISK_SELECT}
         FROM risks WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [riskId, organizationId]
      );

      if ((existingResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "risk_not_found" });
        return;
      }
      const before = existingResult.rows[0]!;

      // Build dynamic SET clause.
      const setClauses: string[] = ["updated_at = NOW()"];
      const updateParams: unknown[] = [];

      function addField(column: string, value: unknown) {
        updateParams.push(value);
        setClauses.push(`${column} = $${updateParams.length}`);
      }

      if (input.title !== undefined) addField("title", input.title);
      if (input.description !== undefined) addField("description", input.description);
      if (input.domain !== undefined) addField("domain", input.domain);
      if (input.likelihood !== undefined) addField("likelihood", input.likelihood);
      if (input.impact !== undefined) addField("impact", input.impact);
      if (input.risk_rating !== undefined) addField("risk_rating", input.risk_rating);
      if (input.inherent_likelihood !== undefined) addField("inherent_likelihood", input.inherent_likelihood);
      if (input.inherent_impact     !== undefined) addField("inherent_impact",     input.inherent_impact);
      if (input.inherent_rating     !== undefined) addField("inherent_rating",     input.inherent_rating);
      if (input.residual_likelihood !== undefined) addField("residual_likelihood", input.residual_likelihood);
      if (input.residual_impact     !== undefined) addField("residual_impact",     input.residual_impact);
      if (input.residual_rating     !== undefined) addField("residual_rating",     input.residual_rating);

      // Legacy column sync — Decision §5. When the caller PATCHes any
      // residual_* field (and didn't ALSO supply the matching legacy
      // field explicitly), mirror residual into the legacy column so
      // the webhook payload's `risk_rating` stays in sync.
      //
      // If the caller patches ONLY inherent_*, legacy columns are NOT
      // touched — inherent changes don't affect the post-controls
      // assessment that webhook consumers rely on.
      if (input.residual_likelihood !== undefined && input.likelihood === undefined) {
        addField("likelihood", input.residual_likelihood);
      }
      if (input.residual_impact !== undefined && input.impact === undefined) {
        addField("impact", input.residual_impact);
      }
      if (input.residual_rating !== undefined && input.risk_rating === undefined) {
        addField("risk_rating", input.residual_rating);
      }

      if (input.status !== undefined) addField("status", input.status);
      if (input.treatment !== undefined) addField("treatment", input.treatment);

      // Owner handling: PATCH may update owner (text), owner_user_id
      // (FK), or both. When owner_user_id is set to a real user and the
      // caller did NOT also supply an explicit `owner`, denormalize the
      // resolved user's name into the text column for fallback safety.
      // When owner_user_id is set to null, leave the text column alone
      // unless the caller also supplied owner explicitly.
      let ownerToWrite: string | null | undefined = input.owner;
      if (input.owner_user_id !== undefined && input.owner_user_id !== null) {
        const resolved = await resolveOwnerUserSameOrg(
          client,
          input.owner_user_id,
          organizationId
        );
        if ("error" in resolved) {
          await client.query("ROLLBACK");
          res.status(400).json({
            error: "invalid_owner_user_id",
            detail: "User is not a member of this organization."
          });
          return;
        }
        if (ownerToWrite === undefined) {
          ownerToWrite = resolved.name;
        }
      }
      if (ownerToWrite !== undefined) addField("owner", ownerToWrite);
      if (input.owner_user_id !== undefined) addField("owner_user_id", input.owner_user_id);

      if (input.due_date !== undefined) addField("due_date", input.due_date);
      if (input.source_type !== undefined) addField("source_type", input.source_type);
      if (input.source_id !== undefined) addField("source_id", input.source_id);

      // RR-5: per-risk cadence override. Setting it here does NOT
      // recompute next_review_due — that happens on the next
      // POST /api/risks/:id/review call. Caller can also clear with null.
      if (input.review_cadence_days !== undefined) {
        addField("review_cadence_days", input.review_cadence_days);
      }

      updateParams.push(riskId, organizationId);
      const idParam = updateParams.length - 1;
      const orgParam = updateParams.length;

      const updatedResult = await client.query(
        `
        UPDATE risks
        SET ${setClauses.join(", ")}
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING ${RISK_SELECT}
        `,
        updateParams
      );

      const risk = updatedResult.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "risk_updated",
          organizationId,
          riskId: risk.id,
          fields: Object.keys(input)
        },
        "Risk record updated"
      );

      // Audit payload (RR-3 fix 1.2): emit a per-field { before, after }
      // diff for every mutable column the PATCH actually changed. The
      // legacy `fields` array (just changed key names) and the explicit
      // `inherent_rating` / `residual_rating` keys are preserved so any
      // existing consumer of the payload shape keeps working.
      const diffs: Record<string, { before: unknown; after: unknown }> = {};
      for (const f of DIFFABLE_FIELDS) {
        if ((input as Record<string, unknown>)[f] !== undefined) {
          diffs[f] = {
            before: (before as Record<string, unknown>)[f] ?? null,
            after: (risk as Record<string, unknown>)[f] ?? null
          };
        }
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId: req.userId ?? null,
        eventType: "risk.updated",
        resourceType: "risk",
        resourceId: risk.id as string,
        payload: {
          fields: Object.keys(input),
          diffs,
          inherent_rating:
            input.inherent_rating !== undefined
              ? { before: before.inherent_rating, after: risk.inherent_rating }
              : undefined,
          residual_rating:
            input.residual_rating !== undefined
              ? { before: before.residual_rating, after: risk.residual_rating }
              : undefined
        },
        ipAddress: req.ip ?? null
      });

      // Webhook on PATCH — closes the gap flagged in earlier
      // investigation (item 1 from Decision §11 scope). Same payload
      // shape as POST /api/risks; consumers receive risk_rating
      // mirroring residual_rating per Decision §5.
      dispatchWebhookEvent({
        event_type: "risk.updated",
        organization_id: organizationId,
        data: {
          id: risk.id,
          title: risk.title,
          risk_rating: risk.residual_rating,
          inherent_rating: risk.inherent_rating,
          residual_rating: risk.residual_rating,
          domain: risk.domain,
        },
      }).catch(() => {});

      res.status(200).json({ risk });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "risk_update_failed", err },
        "PATCH /api/risks/:id failed"
      );
      res.status(500).json({ error: "risk_update_failed" });
    } finally {
      client.release();
    }
  })
);

export default router;
