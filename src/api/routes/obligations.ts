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
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  validateObligationCreate,
  validateObligationPatch
} from "../lib/obligationValidation.js";

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
  byDomainRows: ReadonlyArray<{ domain: string; count: string }>
): {
  total: number;
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

  return { total, by_status, by_domain };
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
  requireEntitlement("standard"),
  async (req, res) => {
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
  }
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
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    // Status filter: default to active
    const filterStatus = isNonEmptyString(req.query.status)
      ? (req.query.status as string).trim()
      : "active";

    if (!VALID_STATUS_FILTERS.has(filterStatus)) {
      res.status(400).json({
        error: "invalid_status_filter",
        allowed: [...VALID_STATUS_FILTERS]
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

      params.push(filterStatus);
      conditions.push(`status = $${params.length}`);

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
  }
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
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const [byStatusResult, byDomainResult] = await Promise.all([
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
        )
      ]);

      const summary = buildObligationSummary(
        byStatusResult.rows,
        byDomainResult.rows
      );

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "obligation_summary_failed", err },
        "GET /api/obligations/summary failed"
      );
      res.status(500).json({ error: "obligation_summary_failed" });
    }
  }
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
  requireEntitlement("standard"),
  async (req, res) => {
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

      res.status(200).json({ obligation: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "obligation_get_failed", err },
        "GET /api/obligations/:id failed"
      );
      res.status(500).json({ error: "obligation_get_failed" });
    }
  }
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
  requireEntitlement("standard"),
  async (req, res) => {
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
  }
);

export default router;
