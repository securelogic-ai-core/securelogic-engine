/**
 * obligations.ts — Regulatory/compliance obligation primitives API
 *
 * Obligations are first-class org-scoped records representing regulatory or
 * compliance requirements an organization must meet (e.g. HIPAA §164.312,
 * GDPR Art. 17, a specific SOC 2 criterion).
 *
 * Routes:
 *   POST   /api/obligations       — create obligation
 *   GET    /api/obligations       — list obligations (active by default)
 *   GET    /api/obligations/:id   — get single obligation
 *   PATCH  /api/obligations/:id   — update obligation fields
 *
 * No hard-delete route. Obligations are lifecycle-managed via status field:
 *   active | waived | not_applicable
 *
 * This package is structural only — no findings are produced here.
 * Finding production belongs to obligation-assessment-workflow (Layer 3).
 *
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { ownerCondition, mayAccessOwned, isAssignedScope } from "../lib/contributorScope.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { asTenant } from "../middleware/asTenant.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import {
  validateObligationCreate,
  validateObligationPatch
} from "../lib/obligationValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { sqlFindingActive, sqlObligationOverdue } from "../lib/metricDefinitions.js";
import {
  OBLIGATION_HISTORY_SPEC,
  fetchResourceHistory,
  isHistoryUuid,
  parseHistoryLimit,
  parseHistoryOffset,
} from "../lib/resourceHistory.js";
import { searchLikePattern } from "../lib/findingQuerySearch.js";

const router = Router();

// ---------------------------------------------------------------------------
// Pure helper — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Aggregate obligation DB rows into a summary object.
 * All canonical status and domain keys are always present in by_status.
 * by_domain is built from actual DB rows (domain is non-exhaustive).
 * Exported for unit testing without a live database.
 */
export function buildObligationSummary(
  byStatusRows: ReadonlyArray<{ status: string; count: string }>,
  byDomainRows: ReadonlyArray<{ domain: string; count: string }>,
  overdueRow: { count: string } | null = null
): {
  total: number;
  overdue: number;
  by_status: Record<string, number>;
  by_domain: Record<string, number>;
} {
  const by_status: Record<string, number> = {
    active: 0,
    waived: 0,
    not_applicable: 0
  };
  for (const row of byStatusRows) {
    if (row.status in by_status) {
      by_status[row.status] = parseInt(row.count, 10);
    }
  }

  const by_domain: Record<string, number> = {};
  for (const row of byDomainRows) {
    by_domain[row.domain] = parseInt(row.count, 10);
  }

  const total = Object.values(by_status).reduce((s, n) => s + n, 0);

  // Metric Contract: overdue = ACTIVE with due_date strictly before today
  // (sqlObligationOverdue) — the missed-regulatory-deadline number.
  const overdue = overdueRow ? parseInt(overdueRow.count, 10) : 0;

  return { total, overdue, by_status, by_domain };
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_STATUS_FILTERS = new Set(["active", "waived", "not_applicable"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

const OBLIGATION_SELECT = `
  id,
  organization_id,
  title,
  description,
  source_regulation,
  jurisdiction,
  domain,
  status,
  priority,
  due_date,
  owner_user_id,
  notes,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/obligations
   Create an obligation for the requesting organization.
   ========================================================= */

router.post(
  "/obligations",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateObligationCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      const result = await pg.query(
        `
        INSERT INTO obligations (
          organization_id,
          title,
          description,
          source_regulation,
          jurisdiction,
          domain,
          status,
          priority,
          due_date,
          owner_user_id,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING ${OBLIGATION_SELECT}
        `,
        [
          organizationId,
          input.title,
          input.description,
          input.source_regulation,
          input.jurisdiction,
          input.domain,
          input.status,
          input.priority,
          input.due_date,
          input.owner_user_id ?? (req as any).autoUserId ?? null,
          input.notes
        ]
      );

      logger.info(
        {
          event: "obligation_created",
          organizationId,
          obligationId: result.rows[0]?.id,
          title: input.title,
          status: input.status
        },
        "Obligation created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "obligation.created",
        resourceType: "obligation",
        resourceId: result.rows[0].id as string,
        payload: { title: input.title },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ obligation: result.rows[0] });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({
          error: "obligation_title_already_exists",
          title: input.title
        });
        return;
      }

      logger.error(
        { event: "obligation_create_failed", err },
        "POST /api/obligations failed"
      );
      res.status(500).json({ error: "obligation_create_failed" });
    }
  })
);

/* =========================================================
   GET /api/obligations
   List obligations for the requesting organization.
   Default: active obligations only.
   Supports cursor pagination, status filter, and domain filter.
   Sort: created_at DESC, id DESC (consistent with all primitive list routes).
   ========================================================= */

router.get(
  "/obligations",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    // Status filter: default to active (unchanged contract for existing
    // callers). The explicit `status=all` sentinel returns every lifecycle
    // state — the register view the UI tabs need; absence-of-param stays
    // "active" so no existing client's list silently grows.
    const filterStatus = isNonEmptyString(req.query.status)
      ? (req.query.status as string).trim()
      : "active";

    if (filterStatus !== "all" && !VALID_STATUS_FILTERS.has(filterStatus)) {
      res.status(400).json({
        error: "invalid_status_filter",
        allowed: [...VALID_STATUS_FILTERS, "all"]
      });
      return;
    }

    // Domain filter: optional
    const filterDomain = isNonEmptyString(req.query.domain)
      ? (req.query.domain as string).trim()
      : null;

    try {
      const limit = parseLimit(req.query.limit);
      const beforeCreatedAt = isNonEmptyString(req.query.before_created_at)
        ? req.query.before_created_at
        : null;
      const beforeId = isNonEmptyString(req.query.before_id)
        ? req.query.before_id
        : null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];
      // Contributor seats see only rows they own. Inert otherwise / flag off.
      const contribClause = ownerCondition(req, "owner_user_id", params);
      if (contribClause) conditions.push(contribClause);

      if (filterStatus !== "all") {
        params.push(filterStatus);
        conditions.push(`status = $${params.length}`);
      }

      // ?overdue=true — the deep-link destination for the overdue count
      // (Metric Contract: sqlObligationOverdue pins status='active', so this
      // composes with the default/active status filter and would honestly
      // return zero rows combined with status=waived/not_applicable).
      if (req.query.overdue === "true") {
        conditions.push(sqlObligationOverdue());
      }

      // Register search — platform 2–120 bounds, ratified ILIKE escaping.
      // Matches the fields a compliance officer knows an obligation by:
      // title, the regulation it comes from, and the description.
      if (req.query.q !== undefined && !(typeof req.query.q === "string" && req.query.q.trim().length === 0)) {
        const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
        if (term.length < 2 || term.length > 120) {
          res.status(400).json({ error: "invalid_search" });
          return;
        }
        params.push(searchLikePattern(term));
        conditions.push(
          `(title ILIKE $${params.length} OR COALESCE(source_regulation, '') ILIKE $${params.length} OR COALESCE(description, '') ILIKE $${params.length})`
        );
      }

      if (filterDomain !== null) {
        params.push(filterDomain);
        conditions.push(`domain = $${params.length}`);
      }

      if (useCursor) {
        if (!isUuid(beforeId)) {
          res.status(400).json({ error: "before_id_must_be_uuid" });
          return;
        }
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT ${OBLIGATION_SELECT}
        FROM obligations
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const obligations = result.rows;
      const last = obligations.length > 0 ? obligations[obligations.length - 1] : null;

      res.status(200).json({
        count: obligations.length,
        limit,
        organizationId,
        statusFilter: filterStatus,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        obligations
      });
    } catch (err) {
      logger.error(
        { event: "obligations_list_failed", err },
        "GET /api/obligations failed"
      );
      res.status(500).json({ error: "obligations_list_failed" });
    }
  })
);

/* =========================================================
   GET /api/obligations/summary
   Aggregate counts for the org's obligation inventory:
   - by_status: count per lifecycle status
   - by_domain: count per domain value (non-exhaustive)
   ========================================================= */

router.get(
  "/obligations/summary",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const [byStatusResult, byDomainResult, overdueResult] = await Promise.all([
        pg.query<{ status: string; count: string }>(
          `
          SELECT status, COUNT(*)::text AS count
          FROM obligations
          WHERE organization_id = $1
          GROUP BY status
          `,
          [organizationId]
        ),
        pg.query<{ domain: string; count: string }>(
          `
          SELECT domain, COUNT(*)::text AS count
          FROM obligations
          WHERE organization_id = $1
          GROUP BY domain
          ORDER BY count DESC, domain ASC
          `,
          [organizationId]
        ),
        pg.query<{ count: string }>(
          `
          SELECT COUNT(*)::text AS count
          FROM obligations
          WHERE organization_id = $1
            AND ${sqlObligationOverdue()}
          `,
          [organizationId]
        )
      ]);

      const summary = buildObligationSummary(
        byStatusResult.rows,
        byDomainResult.rows,
        overdueResult.rows[0] ?? null
      );

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "obligation_summary_failed", err },
        "GET /api/obligations/summary failed"
      );
      res.status(500).json({ error: "obligation_summary_failed" });
    }
  })
);

/* =========================================================
   GET /api/obligations/:id
   Get a single obligation. Returns 404 if not found or if
   the obligation belongs to a different organization.
   ========================================================= */

router.get(
  "/obligations/:id",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const obligationId = String(req.params["id"] ?? "").trim();
    if (!obligationId) {
      res.status(400).json({ error: "obligation_id_required" });
      return;
    }
    if (!isUuid(obligationId)) {
      res.status(400).json({ error: "obligation_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${OBLIGATION_SELECT}
        FROM obligations
        WHERE id = $1
          AND organization_id = $2
        `,
        [obligationId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "obligation_not_found" });
        return;
      }

      // Contributor seats may read only rows they own; else 404.
      if (!mayAccessOwned(req, result.rows[0].owner_user_id)) {
        res.status(404).json({ error: "obligation_not_found" });
        return;
      }

      res.status(200).json({ obligation: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "obligation_get_failed", err },
        "GET /api/obligations/:id failed"
      );
      res.status(500).json({ error: "obligation_get_failed" });
    }
  })
);

/* =========================================================
   GET /api/obligations/:id/history
   Per-obligation audit trail — the RR-3 per-risk history pattern
   generalized via src/api/lib/resourceHistory.ts. Events on the
   obligation plus its assessments and risk-obligation links,
   newest first, mirroring the GET /api/audit-log field shape.

   Auth mirrors GET /api/obligations/:id (no admin gate) — anyone
   who can read the obligation can read its history.
   ========================================================= */

router.get(
  "/obligations/:id/history",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const obligationId = String(req.params.id ?? "").trim();
    if (!obligationId) {
      res.status(400).json({ error: "obligation_id_required" });
      return;
    }
    if (!isHistoryUuid(obligationId)) {
      res.status(400).json({ error: "obligation_id_must_be_uuid" });
      return;
    }

    const limit  = parseHistoryLimit(req.query.limit);
    const offset = parseHistoryOffset(req.query.offset);

    try {
      // Ownership first: cross-org probes must 404 (an empty events
      // list for a foreign id would leak existence by absence).
      const ownership = await pg.query(
        `SELECT 1 FROM obligations WHERE id = $1 AND organization_id = $2`,
        [obligationId, organizationId]
      );
      if ((ownership.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "obligation_not_found" });
        return;
      }

      const page = await fetchResourceHistory(
        OBLIGATION_HISTORY_SPEC,
        organizationId,
        obligationId,
        limit,
        offset
      );
      res.status(200).json(page);
    } catch (err) {
      logger.error(
        { event: "obligation_history_failed", err, obligationId },
        "GET /api/obligations/:id/history failed"
      );
      res.status(500).json({ error: "obligation_history_failed" });
    }
  })
);

/* =========================================================
   GET /api/obligations/:id/findings

   The findings linked to ONE obligation, resolved in the database.

   This exists because the detail page improvised the scoping in the browser: it
   fetched the org's `obligation_review` findings with `limit: 100` and filtered
   them down to the assessments of THIS obligation — assessments it had itself
   fetched with `limit: 20`. A double truncation, and the cap was applied BEFORE
   the filter both times. Past 100 obligation findings in the org (or 20
   assessments on the obligation), a real finding fell off the end of the page
   before the filter ever saw it, and the page printed a confident "0 open
   findings" for an obligation that had them.

   A truncation is not a zero. The linkage is a join, so it belongs in the join.

   Findings link to the ASSESSMENT (source_id = obligation_assessments.id), never
   to the obligation directly — the obligation is reached through it.

   `total` / `active_total` / `open_total` are COUNT(*) over the WHOLE matched set,
   never the length of the returned page: the rows are for display and are bounded;
   the counts are the truth a tile is allowed to print.
   ========================================================= */

router.get(
  "/obligations/:id/findings",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const obligationId = String(req.params.id ?? "").trim();
      if (!isUuid(obligationId)) {
        res.status(400).json({ error: "obligation_id_must_be_uuid" });
        return;
      }

      const limit = parseLimit(req.query.limit);

      // The matched set, defined ONCE and reused by both the page and the counts,
      // so the number on the tile and the rows beneath it cannot disagree.
      const linked = `
        SELECT f.id, f.title, f.severity, f.status, f.operational_status,
               f.domain, f.description, f.source_type, f.source_id,
               f.created_at, f.updated_at
          FROM findings f
          JOIN obligation_assessments oa
            ON oa.id::text = f.source_id::text
           AND f.source_type = 'obligation_review'
         WHERE oa.obligation_id = $1
           AND oa.organization_id = $2
           AND f.organization_id = $2
      `;

      const [rowsResult, countResult] = await Promise.all([
        pg.query(
          `WITH linked AS (${linked})
           SELECT * FROM linked ORDER BY created_at DESC LIMIT $3`,
          [obligationId, organizationId, limit]
        ),
        pg.query<{ total: string; active_total: string; open_total: string }>(
          `WITH linked AS (${linked})
           SELECT COUNT(*)::text                                      AS total,
                  COUNT(*) FILTER (WHERE ${sqlFindingActive()})::text AS active_total,
                  COUNT(*) FILTER (WHERE status = 'open')::text       AS open_total
             FROM linked`,
          [obligationId, organizationId]
        )
      ]);

      const counts = countResult.rows[0];
      res.status(200).json({
        findings: rowsResult.rows,
        total: parseInt(counts?.total ?? "0", 10),
        // Both populations, both true counts. active_total is the canonical
        // enterprise metric (operational_status <> 'closed'); open_total is the
        // strictly-open population this page has always displayed. The route
        // reports both honestly and lets the surface choose — converging the
        // vocabulary is a platform decision, not a detail page's to prejudge.
        active_total: parseInt(counts?.active_total ?? "0", 10),
        open_total: parseInt(counts?.open_total ?? "0", 10),
      });
    } catch (err) {
      logger.error(
        { event: "obligation_findings_failed", err },
        "GET /api/obligations/:id/findings failed"
      );
      res.status(500).json({ error: "obligation_findings_failed" });
    }
  })
);

/* =========================================================
   PATCH /api/obligations/:id
   Update obligation fields. At least one patchable field required.
   Returns 404 if not found or belongs to a different org.
   ========================================================= */

router.patch(
  "/obligations/:id",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const obligationId = String(req.params["id"] ?? "").trim();
    if (!obligationId) {
      res.status(400).json({ error: "obligation_id_required" });
      return;
    }
    if (!isUuid(obligationId)) {
      res.status(400).json({ error: "obligation_id_must_be_uuid" });
      return;
    }

    const validated = validateObligationPatch(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const updates: string[] = [];
    const values: unknown[] = [];

    if ("title" in input) {
      values.push(input.title);
      updates.push(`title = $${values.length}`);
    }
    if ("description" in input) {
      values.push(input.description ?? null);
      updates.push(`description = $${values.length}`);
    }
    if ("source_regulation" in input) {
      values.push(input.source_regulation ?? null);
      updates.push(`source_regulation = $${values.length}`);
    }
    if ("jurisdiction" in input) {
      values.push(input.jurisdiction ?? null);
      updates.push(`jurisdiction = $${values.length}`);
    }
    if ("domain" in input) {
      values.push(input.domain ?? null);
      updates.push(`domain = $${values.length}`);
    }
    if ("status" in input) {
      values.push(input.status);
      updates.push(`status = $${values.length}`);
    }
    if ("priority" in input) {
      values.push(input.priority ?? null);
      updates.push(`priority = $${values.length}`);
    }
    if ("due_date" in input) {
      values.push(input.due_date ?? null);
      updates.push(`due_date = $${values.length}`);
    }
    if ("owner_user_id" in input) {
      values.push(input.owner_user_id ?? null);
      updates.push(`owner_user_id = $${values.length}`);
    }
    if ("notes" in input) {
      values.push(input.notes ?? null);
      updates.push(`notes = $${values.length}`);
    }

    values.push(obligationId, organizationId);
    const idParam = values.length - 1;
    const orgParam = values.length;

    try {
      const result = await pg.query(
        `
        UPDATE obligations
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING ${OBLIGATION_SELECT}
        `,
        values
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "obligation_not_found" });
        return;
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "obligation.updated",
        resourceType: "obligation",
        resourceId: obligationId,
        payload: { fields: Object.keys(input) },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ obligation: result.rows[0] });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({
          error: "obligation_title_already_exists",
          title: input.title
        });
        return;
      }

      logger.error(
        { event: "obligation_patch_failed", err },
        "PATCH /api/obligations/:id failed"
      );
      res.status(500).json({ error: "obligation_patch_failed" });
    }
  })
);

export default router;
