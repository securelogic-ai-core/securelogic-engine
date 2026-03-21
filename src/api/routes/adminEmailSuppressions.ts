import { Router } from "express";
import { pg } from "../infra/postgres.js";

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

router.get("/email-suppressions", async (req, res) => {
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
            email,
            reason,
            source,
            created_at
          FROM email_suppressions
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
            email,
            reason,
            source,
            created_at
          FROM email_suppressions
          ORDER BY created_at DESC, id DESC
          LIMIT $1
          `,
          [limit]
        );

    const suppressions = result.rows;
    const last = suppressions.length > 0 ? suppressions[suppressions.length - 1] : null;

    res.status(200).json({
      count: suppressions.length,
      limit,
      beforeCreatedAt: useCursor ? beforeCreatedAt : null,
      beforeId: useCursor ? beforeId : null,
      nextCursor: last
        ? {
            created_at: last.created_at,
            id: last.id
          }
        : null,
      suppressions
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_email_suppressions_query_failed" });
  }
});

export default router;
