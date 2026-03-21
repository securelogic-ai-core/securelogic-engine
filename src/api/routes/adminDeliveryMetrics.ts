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

router.get("/delivery-metrics", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const beforeCreatedAt = parseCursorPart(req.query.beforeCreatedAt);
    const beforeIssueId = parseCursorPart(req.query.beforeIssueId);

    const useCursor = Boolean(beforeCreatedAt && beforeIssueId);

    const result = useCursor
      ? await pg.query(
          `
          SELECT
            ni.id AS issue_id,
            ni.title,
            ni.status AS issue_status,
            ni.created_at AS issue_created_at,
            COUNT(nd.id)::int AS total_deliveries,
            COUNT(*) FILTER (WHERE nd.status = 'queued')::int AS queued_count,
            COUNT(*) FILTER (WHERE nd.status = 'sent')::int AS sent_count,
            COUNT(*) FILTER (WHERE nd.status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE nd.dead_lettered_at IS NOT NULL)::int AS dead_lettered_count,
            COUNT(*) FILTER (WHERE nd.last_error = 'suppressed_email_blocked')::int AS suppressed_blocked_count
          FROM newsletter_issues ni
          LEFT JOIN newsletter_deliveries nd
            ON nd.issue_id = ni.id
          WHERE (ni.created_at, ni.id) < ($2::timestamptz, $3::uuid)
          GROUP BY ni.id, ni.title, ni.status, ni.created_at
          ORDER BY ni.created_at DESC, ni.id DESC
          LIMIT $1
          `,
          [limit, beforeCreatedAt, beforeIssueId]
        )
      : await pg.query(
          `
          SELECT
            ni.id AS issue_id,
            ni.title,
            ni.status AS issue_status,
            ni.created_at AS issue_created_at,
            COUNT(nd.id)::int AS total_deliveries,
            COUNT(*) FILTER (WHERE nd.status = 'queued')::int AS queued_count,
            COUNT(*) FILTER (WHERE nd.status = 'sent')::int AS sent_count,
            COUNT(*) FILTER (WHERE nd.status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE nd.dead_lettered_at IS NOT NULL)::int AS dead_lettered_count,
            COUNT(*) FILTER (WHERE nd.last_error = 'suppressed_email_blocked')::int AS suppressed_blocked_count
          FROM newsletter_issues ni
          LEFT JOIN newsletter_deliveries nd
            ON nd.issue_id = ni.id
          GROUP BY ni.id, ni.title, ni.status, ni.created_at
          ORDER BY ni.created_at DESC, ni.id DESC
          LIMIT $1
          `,
          [limit]
        );

    const metrics = result.rows;
    const last = metrics.length > 0 ? metrics[metrics.length - 1] : null;

    res.status(200).json({
      count: metrics.length,
      limit,
      beforeCreatedAt: useCursor ? beforeCreatedAt : null,
      beforeIssueId: useCursor ? beforeIssueId : null,
      nextCursor: last
        ? {
            created_at: last.issue_created_at,
            issue_id: last.issue_id
          }
        : null,
      metrics
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_delivery_metrics_query_failed" });
  }
});

export default router;
