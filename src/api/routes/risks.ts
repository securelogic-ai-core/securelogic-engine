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
import {
  validateRiskCreate,
  validateRiskUpdate,
  validateRiskListQuery
} from "../lib/riskValidation.js";

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
  byDomainRows: ReadonlyArray<{ domain: string; count: string }>
): {
  total: number;
  open_critical_count: number;
  by_status: Record<string, number>;
  by_risk_rating: Record<string, number>;
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

  const by_domain: Record<string, number> = {};
  for (const row of byDomainRows) {
    by_domain[row.domain] = parseInt(row.count, 10);
  }

  const total = Object.values(by_status).reduce((s, n) => s + n, 0);
  const open_critical_count = by_risk_rating["Critical"] ?? 0;

  return { total, open_critical_count, by_status, by_risk_rating, by_domain };
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
  status,
  treatment,
  owner,
  due_date,
  source_type,
  source_id,
  created_at,
  updated_at
`;

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
  requireEntitlement("standard"),
  async (req, res) => {
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
          status,
          treatment,
          owner,
          due_date,
          source_type,
          source_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          input.status,
          input.treatment ?? null,
          input.owner ?? null,
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
          riskRating: input.risk_rating
        },
        "Risk record created"
      );

      res.status(201).json({ risk });
    } catch (err) {
      logger.error(
        { event: "risk_create_failed", err },
        "POST /api/risks failed"
      );
      res.status(500).json({ error: "risk_create_failed" });
    }
  }
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
  requireEntitlement("standard"),
  async (req, res) => {
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
  }
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
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const [byStatusResult, byRatingResult, byDomainResult] =
        await Promise.all([
          pg.query<{ status: string; count: string }>(
            `
            SELECT status, COUNT(*)::text AS count
            FROM risks
            WHERE organization_id = $1
            GROUP BY status
            `,
            [organizationId]
          ),
          pg.query<{ risk_rating: string; count: string }>(
            `
            SELECT risk_rating, COUNT(*)::text AS count
            FROM risks
            WHERE organization_id = $1
            GROUP BY risk_rating
            `,
            [organizationId]
          ),
          pg.query<{ domain: string; count: string }>(
            `
            SELECT domain, COUNT(*)::text AS count
            FROM risks
            WHERE organization_id = $1
            GROUP BY domain
            ORDER BY count DESC, domain ASC
            `,
            [organizationId]
          )
        ]);

      const summary = buildRiskSummary(
        byStatusResult.rows,
        byRatingResult.rows,
        byDomainResult.rows
      );

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "risk_summary_failed", err },
        "GET /api/risks/summary failed"
      );
      res.status(500).json({ error: "risk_summary_failed" });
    }
  }
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
 */
export function buildRiskIntelligenceList(rows: ReadonlyArray<RiskIntelligenceRow>): Array<{
  id: string;
  title: string;
  domain: string;
  risk_rating: string;
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
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const result = await pg.query<RiskIntelligenceRow>(
        `
        SELECT
          r.id,
          r.title,
          r.domain,
          r.risk_rating,
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
        GROUP BY r.id, r.title, r.domain, r.risk_rating, r.status,
                 r.likelihood, r.owner
        ORDER BY
          CASE r.risk_rating
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
      const openCriticalCount = risks.filter((r) => r.risk_rating === "Critical").length;

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
  }
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
  requireEntitlement("standard"),
  async (req, res) => {
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
  }
);

/* =========================================================
   PATCH /api/risks/:id
   Partial update of a risk record.
   ========================================================= */

router.patch(
  "/risks/:id",
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

      // Verify the risk exists and belongs to this org.
      const existingResult = await client.query(
        `SELECT id FROM risks WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [riskId, organizationId]
      );

      if ((existingResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "risk_not_found" });
        return;
      }

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
      if (input.status !== undefined) addField("status", input.status);
      if (input.treatment !== undefined) addField("treatment", input.treatment);
      if (input.owner !== undefined) addField("owner", input.owner);
      if (input.due_date !== undefined) addField("due_date", input.due_date);
      if (input.source_type !== undefined) addField("source_type", input.source_type);
      if (input.source_id !== undefined) addField("source_id", input.source_id);

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
          riskId: risk.id
        },
        "Risk record updated"
      );

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
  }
);

export default router;
