import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const DEFAULT_LIMIT = 50;
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

function buildWhere(
  search: string,
  plan: string,
  active: string,
  suppressed: string,
  startIdx: number
): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let p = startIdx;

  if (search) {
    conditions.push(
      `(LOWER(ibs.email) LIKE $${p} OR LOWER(COALESCE(ibs.name, '')) LIKE $${p} OR LOWER(COALESCE(o.name, '')) LIKE $${p})`
    );
    params.push(`%${search}%`);
    p++;
  }

  if (plan === "free") {
    conditions.push(`COALESCE(k.entitlement_level, 'starter') IN ('starter', 'free')`);
  } else if (plan === "professional") {
    conditions.push(`k.entitlement_level = 'professional'`);
  } else if (plan === "platform" || plan === "premium") {
    conditions.push(`k.entitlement_level IN ('premium', 'platform', 'team')`);
  }

  if (active === "true") {
    conditions.push("ibs.active = true");
  } else if (active === "false") {
    conditions.push("ibs.active = false");
  }

  if (suppressed === "true") {
    conditions.push("es.id IS NOT NULL");
  } else if (suppressed === "false") {
    conditions.push("es.id IS NULL");
  }

  return {
    clause: conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "",
    params
  };
}

const LATERAL_KEY = `
  LEFT JOIN LATERAL (
    SELECT entitlement_level
    FROM api_keys ak
    WHERE ak.organization_id = ibs.organization_id AND ak.status = 'active'
    ORDER BY ak.created_at ASC
    LIMIT 1
  ) k ON true
`;

/* =========================================================
   GET /admin/brief-subscribers/summary
   ========================================================= */

router.get("/brief-subscribers/summary", async (_req, res) => {
  try {
    const result = await pg.query(`
      SELECT
        COUNT(*) FILTER (WHERE ibs.active = true)::int AS total_active,
        COUNT(*) FILTER (WHERE ibs.active = true AND COALESCE(k.entitlement_level, 'starter') IN ('starter', 'free'))::int AS free_count,
        COUNT(*) FILTER (WHERE ibs.active = true AND k.entitlement_level = 'professional')::int AS professional_count,
        COUNT(*) FILTER (WHERE ibs.active = true AND k.entitlement_level IN ('premium', 'platform', 'team'))::int AS platform_count,
        COUNT(*) FILTER (WHERE es.id IS NOT NULL)::int AS suppressed_count,
        COUNT(*) FILTER (WHERE ibs.active = true AND ibs.subscribed_at >= NOW() - INTERVAL '7 days')::int AS new_last_7_days,
        COUNT(*) FILTER (WHERE ibs.active = true AND ibs.subscribed_at >= NOW() - INTERVAL '30 days')::int AS new_last_30_days,
        COUNT(*) FILTER (WHERE ibs.active = false AND ibs.unsubscribed_at >= NOW() - INTERVAL '30 days')::int AS churn_last_30_days
      FROM intelligence_brief_subscribers ibs
      LEFT JOIN organizations o ON o.id = ibs.organization_id
      ${LATERAL_KEY}
      LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(ibs.email)
    `);

    const r = result.rows[0] ?? {};
    res.status(200).json({
      total_active:      Number(r.total_active      ?? 0),
      by_plan: {
        free:            Number(r.free_count         ?? 0),
        professional:    Number(r.professional_count ?? 0),
        platform:        Number(r.platform_count     ?? 0),
      },
      suppressed_count:  Number(r.suppressed_count   ?? 0),
      new_last_7_days:   Number(r.new_last_7_days    ?? 0),
      new_last_30_days:  Number(r.new_last_30_days   ?? 0),
      churn_last_30_days: Number(r.churn_last_30_days ?? 0),
    });
  } catch (err) {
    logger.error({ event: "admin_brief_subscribers_summary_failed", err }, "GET /admin/brief-subscribers/summary failed");
    res.status(500).json({ error: "brief_subscribers_summary_failed" });
  }
});

/* =========================================================
   GET /admin/brief-subscribers
   ?search=  ?plan=free|professional|platform  ?active=true|false
   ?suppressed=true|false  ?limit=50  ?offset=0
   ========================================================= */

router.get("/brief-subscribers", async (req, res) => {
  try {
    const limit  = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);

    const search    = String(req.query.search    ?? "").trim().toLowerCase();
    const plan      = String(req.query.plan      ?? "").trim().toLowerCase();
    const active    = String(req.query.active    ?? "").trim().toLowerCase();
    const suppressed = String(req.query.suppressed ?? "").trim().toLowerCase();

    const mainWhere  = buildWhere(search, plan, active, suppressed, 3);
    const countWhere = buildWhere(search, plan, active, suppressed, 1);

    const mainParams  = [limit, offset, ...mainWhere.params];
    const countParams = countWhere.params;

    const [dataResult, countResult] = await Promise.all([
      pg.query(
        `SELECT
           ibs.id,
           ibs.email,
           ibs.name,
           ibs.organization_id,
           COALESCE(o.name, '—') AS organization_name,
           COALESCE(k.entitlement_level, 'starter') AS plan,
           ibs.active,
           ibs.subscribed_at,
           ibs.unsubscribed_at,
           MAX(s.sent_at) FILTER (WHERE s.status = 'sent') AS last_delivery_at,
           CASE WHEN es.id IS NOT NULL THEN true ELSE false END AS email_suppressed
         FROM intelligence_brief_subscribers ibs
         LEFT JOIN organizations o ON o.id = ibs.organization_id
         ${LATERAL_KEY}
         LEFT JOIN intelligence_brief_sends s ON s.subscriber_id = ibs.id
         LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(ibs.email)
         ${mainWhere.clause}
         GROUP BY ibs.id, o.name, k.entitlement_level, es.id
         ORDER BY ibs.subscribed_at DESC, ibs.id DESC
         LIMIT $1 OFFSET $2`,
        mainParams
      ),
      pg.query(
        `SELECT COUNT(DISTINCT ibs.id)::int AS total
         FROM intelligence_brief_subscribers ibs
         LEFT JOIN organizations o ON o.id = ibs.organization_id
         ${LATERAL_KEY}
         LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(ibs.email)
         ${countWhere.clause}`,
        countParams
      )
    ]);

    res.status(200).json({
      total:       Number(countResult.rows[0]?.total ?? 0),
      count:       dataResult.rows.length,
      limit,
      offset,
      subscribers: dataResult.rows
    });
  } catch (err) {
    logger.error({ event: "admin_brief_subscribers_failed", err }, "GET /admin/brief-subscribers failed");
    res.status(500).json({ error: "brief_subscribers_query_failed" });
  }
});

export default router;
