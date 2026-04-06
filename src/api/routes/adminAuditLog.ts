import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* =========================================================
   GET /admin/audit-log

   Returns a paginated, filterable view of the audit_log table.
   Cursor-based pagination via `before` (ISO timestamp of the
   oldest row from the previous page).

   Query params:
     limit          — rows per page (1–200, default 50)
     before         — ISO timestamp cursor (exclusive upper bound on created_at)
     organization_id — filter by org
     api_key_id     — filter by API key
     route          — exact match on route column
     status_code    — integer filter on HTTP status
     actor_label    — exact match on actor label (key label / name)
   ========================================================= */

router.get("/audit-log", async (req, res) => {
  try {
    // ---- pagination ----
    const rawLimit = Number(req.query.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const beforeRaw = typeof req.query.before === "string"
      ? req.query.before.trim()
      : null;
    const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw))
      ? new Date(beforeRaw)
      : null;

    // ---- filters ----
    const orgId = isValidUuid(req.query.organization_id)
      ? req.query.organization_id
      : null;

    const apiKeyId = isValidUuid(req.query.api_key_id)
      ? req.query.api_key_id
      : null;

    const route = typeof req.query.route === "string" && req.query.route.trim().length > 0
      ? req.query.route.trim().slice(0, 512)
      : null;

    const statusCodeRaw = req.query.status_code !== undefined
      ? Number(req.query.status_code)
      : null;
    const statusCode = statusCodeRaw !== null && Number.isFinite(statusCodeRaw)
      ? statusCodeRaw
      : null;

    const actorLabel = typeof req.query.actor_label === "string" && req.query.actor_label.trim().length > 0
      ? req.query.actor_label.trim().slice(0, 256)
      : null;

    // ---- build query ----
    const conditions: string[] = [];
    const params: unknown[] = [];

    function addParam(value: unknown): string {
      params.push(value);
      return `$${params.length}`;
    }

    if (before) {
      conditions.push(`created_at < ${addParam(before.toISOString())}`);
    }

    if (orgId) {
      conditions.push(`organization_id = ${addParam(orgId)}`);
    }

    if (apiKeyId) {
      conditions.push(`api_key_id = ${addParam(apiKeyId)}`);
    }

    if (route) {
      conditions.push(`route = ${addParam(route)}`);
    }

    if (statusCode !== null) {
      conditions.push(`status_code = ${addParam(statusCode)}`);
    }

    if (actorLabel) {
      conditions.push(`actor_label = ${addParam(actorLabel)}`);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await pg.query(
      `
      SELECT
        id,
        organization_id,
        api_key_id,
        actor_type,
        actor_label,
        action,
        method,
        route,
        status_code,
        request_id,
        duration_ms,
        metadata,
        created_at
      FROM audit_log
      ${where}
      ORDER BY created_at DESC
      LIMIT ${addParam(limit + 1)}
      `,
      params
    );

    // Use limit+1 fetch to determine whether a next page exists
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore && page.length > 0
      ? (page[page.length - 1].created_at as Date).toISOString()
      : null;

    res.status(200).json({
      entries: page,
      pagination: {
        limit,
        hasMore,
        nextCursor
      }
    });
  } catch (err) {
    logger.error({ event: "admin_audit_log_query_failed", err }, "GET /admin/audit-log failed");
    res.status(500).json({ error: "audit_log_query_failed" });
  }
});

export default router;
