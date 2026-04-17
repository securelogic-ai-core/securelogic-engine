import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseOffset(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/* =========================================================
   GET /admin/issues
   Returns intelligence_briefs with per-brief delivery counts.
   ?status=draft|generating|published|failed
   ?limit=25  ?offset=0
   ========================================================= */

router.get("/issues", async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const status = String(req.query.status ?? "").trim().toLowerCase();

    const VALID_STATUSES = new Set(["draft", "generating", "published", "failed"]);

    const conditions: string[] = [];
    const params: unknown[] = [limit, offset];
    let p = 3;

    if (status && VALID_STATUSES.has(status)) {
      conditions.push(`ib.status = $${p}`);
      params.push(status);
      p++;
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const countParams = params.slice(2);
    const countConditions = conditions.map((c, i) =>
      c.replace(`$${i + 3}`, `$${i + 1}`)
    );
    const countWhere = countConditions.length > 0 ? "WHERE " + countConditions.join(" AND ") : "";

    const [dataResult, countResult] = await Promise.all([
      pg.query(
        `SELECT
           ib.id,
           ib.organization_id,
           COALESCE(o.name, '—') AS organization_name,
           ib.period_start,
           ib.period_end,
           ib.status,
           ib.signal_count,
           ib.item_count,
           ib.generated_at,
           ib.published_at,
           ib.created_at,
           COUNT(s.id)::int                                                 AS total_sends,
           COUNT(s.id) FILTER (WHERE s.status = 'sent')::int                AS sent_count,
           COUNT(s.id) FILTER (WHERE s.status = 'failed')::int              AS failed_count,
           COUNT(s.id) FILTER (WHERE s.status = 'suppressed')::int          AS suppressed_count
         FROM intelligence_briefs ib
         LEFT JOIN organizations o ON o.id = ib.organization_id
         LEFT JOIN intelligence_brief_sends s ON s.brief_id = ib.id
         ${whereClause}
         GROUP BY ib.id, o.name
         ORDER BY ib.created_at DESC, ib.id DESC
         LIMIT $1 OFFSET $2`,
        params
      ),
      pg.query(
        `SELECT COUNT(DISTINCT ib.id)::int AS total
         FROM intelligence_briefs ib
         ${countWhere}`,
        countParams
      )
    ]);

    res.status(200).json({
      total:  Number(countResult.rows[0]?.total ?? 0),
      count:  dataResult.rows.length,
      limit,
      offset,
      issues: dataResult.rows
    });
  } catch (err) {
    logger.error({ event: "admin_issues_failed", err }, "GET /admin/issues failed");
    res.status(500).json({ error: "admin_issues_query_failed" });
  }
});

export default router;
