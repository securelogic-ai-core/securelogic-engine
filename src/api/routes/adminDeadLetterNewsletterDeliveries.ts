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

router.get("/dead-letter/newsletter-deliveries", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const beforeDeadLetteredAt = parseCursorPart(req.query.beforeDeadLetteredAt);
    const beforeId = parseCursorPart(req.query.beforeId);

    const useCursor = Boolean(beforeDeadLetteredAt && beforeId);

    const result = useCursor
      ? await pg.query(
          `
          SELECT
            id,
            issue_id,
            subscriber_email,
            status,
            retry_count,
            last_error,
            dead_lettered_at,
            created_at
          FROM newsletter_deliveries
          WHERE dead_lettered_at IS NOT NULL
            AND (dead_lettered_at, id) < ($2::timestamptz, $3::uuid)
          ORDER BY dead_lettered_at DESC, id DESC
          LIMIT $1
          `,
          [limit, beforeDeadLetteredAt, beforeId]
        )
      : await pg.query(
          `
          SELECT
            id,
            issue_id,
            subscriber_email,
            status,
            retry_count,
            last_error,
            dead_lettered_at,
            created_at
          FROM newsletter_deliveries
          WHERE dead_lettered_at IS NOT NULL
          ORDER BY dead_lettered_at DESC, id DESC
          LIMIT $1
          `,
          [limit]
        );

    const deliveries = result.rows;
    const last = deliveries.length > 0 ? deliveries[deliveries.length - 1] : null;

    res.status(200).json({
      count: deliveries.length,
      limit,
      beforeDeadLetteredAt: useCursor ? beforeDeadLetteredAt : null,
      beforeId: useCursor ? beforeId : null,
      nextCursor: last
        ? {
            dead_lettered_at: last.dead_lettered_at,
            id: last.id
          }
        : null,
      deliveries
    });
  } catch (err) {
    logger.error({ event: "admin_dead_letter_deliveries_failed", err }, "POST /admin/newsletter-deliveries/dead-letter failed");
    res.status(500).json({ error: "admin_dead_letter_deliveries_query_failed" });
  }
});

export default router;
