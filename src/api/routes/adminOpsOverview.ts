import { Router } from "express"
import { pg } from "../infra/postgres.js"

const router = Router()

router.get("/ops/overview", async (_req, res) => {
  try {
    const [
      recentIssuesResult,
      deliveryTotalsResult,
      deadLetterCountResult,
      suppressionCountResult,
      recentProviderEventsResult,
      recentWorkerRunsResult
    ] = await Promise.all([
      pg.query(
        `
        SELECT
          id,
          title,
          status,
          created_at
        FROM newsletter_issues
        ORDER BY created_at DESC
        LIMIT 10
        `
      ),
      pg.query(
        `
        SELECT
          COUNT(*)::int AS total_deliveries,
          COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
        FROM newsletter_deliveries
        `
      ),
      pg.query(
        `
        SELECT COUNT(*)::int AS dead_letter_count
        FROM newsletter_deliveries
        WHERE dead_lettered_at IS NOT NULL
        `
      ),
      pg.query(
        `
        SELECT COUNT(*)::int AS suppression_count
        FROM email_suppressions
        `
      ),
      pg.query(
        `
        SELECT
          id,
          provider,
          provider_event_id,
          event_type,
          email,
          created_at
        FROM email_provider_events
        ORDER BY created_at DESC
        LIMIT 10
        `
      ),
      pg.query(
        `
        SELECT
          id,
          worker_name,
          status,
          started_at,
          completed_at,
          duration_ms,
          metadata
        FROM worker_runs
        ORDER BY started_at DESC
        LIMIT 10
        `
      )
    ])

    res.status(200).json({
      ok: true,
      overview: {
        recentIssues: recentIssuesResult.rows,
        deliveryTotals: deliveryTotalsResult.rows[0] ?? {
          total_deliveries: 0,
          queued_count: 0,
          sent_count: 0,
          failed_count: 0
        },
        deadLetterCount: Number(deadLetterCountResult.rows[0]?.dead_letter_count ?? 0),
        suppressionCount: Number(suppressionCountResult.rows[0]?.suppression_count ?? 0),
        recentProviderEvents: recentProviderEventsResult.rows,
        recentWorkerRuns: recentWorkerRunsResult.rows
      }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_ops_overview_query_failed" })
  }
})

export default router
