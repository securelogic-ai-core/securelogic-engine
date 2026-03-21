import { Router } from "express";
import { pg } from "../infra/postgres.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const router = Router();

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

router.get("/delivery-metrics/issues/:id", async (req, res) => {
  try {
    const issueId = String(req.params.id ?? "").trim();

    if (!issueId) {
      res.status(400).json({ error: "issue_id_required" });
      return;
    }

    if (!UUID_RE.test(issueId)) {
      res.status(400).json({ error: "invalid_issue_id" });
      return;
    }

    const limit = parseLimit(req.query.limit);
    const afterCursorTs = parseCursorPart(req.query.afterCursorTs);
    const afterId = parseCursorPart(req.query.afterId);

    const useCursor = Boolean(afterCursorTs && afterId);

    const issueResult = await pg.query(
      `
      SELECT id, title, status, created_at
      FROM newsletter_issues
      WHERE id = $1
      LIMIT 1
      `,
      [issueId]
    );

    if ((issueResult.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "newsletter_issue_not_found" });
      return;
    }

    const deliveryResult = useCursor
      ? await pg.query(
          `
          SELECT
            id,
            subscriber_email,
            status,
            retry_count,
            last_error,
            next_attempt_at,
            dead_lettered_at,
            sent_at,
            provider_message_id,
            created_at,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
          FROM newsletter_deliveries
          WHERE issue_id = $1
            AND (created_at, id) > ($2::timestamptz, $3::uuid)
          ORDER BY created_at ASC, id ASC
          LIMIT $4
          `,
          [issueId, afterCursorTs, afterId, limit]
        )
      : await pg.query(
          `
          SELECT
            id,
            subscriber_email,
            status,
            retry_count,
            last_error,
            next_attempt_at,
            dead_lettered_at,
            sent_at,
            provider_message_id,
            created_at,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
          FROM newsletter_deliveries
          WHERE issue_id = $1
          ORDER BY created_at ASC, id ASC
          LIMIT $2
          `,
          [issueId, limit]
        );

    const deliveries = deliveryResult.rows;
    const last = deliveries.length > 0 ? deliveries[deliveries.length - 1] : null;

    res.status(200).json({
      issue: issueResult.rows[0],
      count: deliveries.length,
      limit,
      afterCursorTs: useCursor ? afterCursorTs : null,
      afterId: useCursor ? afterId : null,
      nextCursor: last
        ? {
            cursorTs: last.created_at_cursor,
            id: last.id
          }
        : null,
      deliveries: deliveries.map(({ created_at_cursor, ...row }) => row)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_issue_delivery_metrics_query_failed" });
  }
});

export default router;
