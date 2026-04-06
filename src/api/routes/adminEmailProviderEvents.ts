import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const raw = String(value ?? "").trim();

  if (!raw) return DEFAULT_LIMIT;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function parseCursorPart(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

router.get("/email-provider-events", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const beforeCreatedAt = parseCursorPart(req.query.beforeCreatedAt);
    const beforeId = parseCursorPart(req.query.beforeId);

    const useCursor = Boolean(beforeCreatedAt && beforeId);

    const result = useCursor
      ? await pg.query(
          `
          SELECT
            id,
            provider,
            provider_event_id,
            event_type,
            email,
            created_at
          FROM email_provider_events
          WHERE (created_at, id) < ($2::timestamptz, $3::uuid)
          ORDER BY created_at DESC, id DESC
          LIMIT $1
          `,
          [limit, beforeCreatedAt, beforeId]
        )
      : await pg.query(
          `
          SELECT
            id,
            provider,
            provider_event_id,
            event_type,
            email,
            created_at
          FROM email_provider_events
          ORDER BY created_at DESC, id DESC
          LIMIT $1
          `,
          [limit]
        );

    const events = result.rows;
    const last = events.length > 0 ? events[events.length - 1] : null;

    res.status(200).json({
      count: events.length,
      limit,
      beforeCreatedAt: useCursor ? beforeCreatedAt : null,
      beforeId: useCursor ? beforeId : null,
      nextCursor: last
        ? {
            created_at: last.created_at,
            id: last.id
          }
        : null,
      events
    });
  } catch (err) {
    logger.error({ event: "admin_email_provider_events_failed", err }, "GET /admin/email-provider-events failed");
    res.status(500).json({ error: "admin_email_provider_events_query_failed" });
  }
});

export default router;
