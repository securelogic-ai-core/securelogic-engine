import { Router } from "express"
import { pg } from "../infra/postgres.js"
import { logger } from "../infra/logger.js"

const router = Router()

router.get("/ops/health", async (_req, res) => {
  try {
    const [
      queuedDeliveriesResult,
      deadLetterCountResult,
      suppressionCountResult,
      failedWorkerRunsResult,
      staleRunningWorkersResult,
      latestIssueResult,
      latestProviderEventResult,
      suppressedPayingResult
    ] = await Promise.all([
      pg.query(
        `
        SELECT COUNT(*)::int AS queued_count
        FROM newsletter_deliveries
        WHERE status = 'queued'
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
        SELECT COUNT(*)::int AS failed_worker_runs_last_24h
        FROM worker_runs
        WHERE status = 'failed'
          AND started_at >= NOW() - INTERVAL '24 hours'
        `
      ),
      pg.query(
        `
        SELECT COUNT(*)::int AS stale_running_workers
        FROM worker_runs
        WHERE status = 'running'
          AND started_at < NOW() - INTERVAL '5 minutes'
        `
      ),
      pg.query(
        `
        SELECT id, title, status, created_at
        FROM newsletter_issues
        ORDER BY created_at DESC
        LIMIT 1
        `
      ),
      pg.query(
        `
        SELECT provider, event_type, email, created_at
        FROM email_provider_events
        ORDER BY created_at DESC
        LIMIT 1
        `
      ),
      pg.query(
        `
        SELECT COUNT(DISTINCT u.id)::int AS suppressed_paying_count
        FROM users u
        INNER JOIN organizations o ON o.id = u.organization_id
        INNER JOIN api_keys k ON k.organization_id = o.id AND k.status = 'active'
        INNER JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
        WHERE k.entitlement_level IN ('professional', 'premium', 'platform', 'team')
          AND o.status = 'active'
        `
      )
    ])

    const queuedCount = Number(queuedDeliveriesResult.rows[0]?.queued_count ?? 0)
    const deadLetterCount = Number(deadLetterCountResult.rows[0]?.dead_letter_count ?? 0)
    const suppressionCount = Number(suppressionCountResult.rows[0]?.suppression_count ?? 0)
    const failedWorkerRunsLast24h = Number(
      failedWorkerRunsResult.rows[0]?.failed_worker_runs_last_24h ?? 0
    )
    const staleRunningWorkers = Number(
      staleRunningWorkersResult.rows[0]?.stale_running_workers ?? 0
    )
    const suppressedPayingCount = Number(
      suppressedPayingResult.rows[0]?.suppressed_paying_count ?? 0
    )

    let status: "healthy" | "degraded" | "failing" = "healthy"
    const reasons: string[] = []

    if (staleRunningWorkers > 0) {
      status = "failing"
      reasons.push("stale_running_workers_detected")
    }

    if (deadLetterCount > 0) {
      status = "failing"
      reasons.push("dead_letters_present")
    }

    if (failedWorkerRunsLast24h > 0) {
      status = "failing"
      reasons.push("recent_worker_failures_present")
    }

    if (status !== "failing" && queuedCount > 25) {
      status = "degraded"
      reasons.push("queued_deliveries_backlog")
    }

    if (status !== "failing" && suppressionCount > 25) {
      status = "degraded"
      reasons.push("suppression_volume_elevated")
    }

    if (suppressedPayingCount > 0) {
      if (status === "healthy") status = "degraded"
      const noun = suppressedPayingCount === 1 ? "subscriber has" : "subscribers have"
      reasons.push(`${suppressedPayingCount} paying ${noun} suppressed email`)
    }

    res.status(200).json({
      ok: true,
      health: {
        status,
        reasons,
        queuedDeliveriesCount: queuedCount,
        deadLetterCount,
        suppressionCount,
        suppressedPayingCount,
        failedWorkerRunsLast24h,
        staleRunningWorkers,
        latestIssue: latestIssueResult.rows[0] ?? null,
        latestProviderEvent: latestProviderEventResult.rows[0] ?? null,
        checkedAt: new Date().toISOString()
      }
    })
  } catch (err) {
    logger.error({ event: "admin_ops_health_failed", err }, "GET /admin/ops/health failed")
    res.status(500).json({ error: "admin_ops_health_query_failed" })
  }
})

export default router
