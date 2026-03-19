import { Router } from "express"
import { pg } from "../infra/postgres.js"

const router = Router()

router.get("/delivery-metrics", async (_req, res) => {
  try {
    const result = await pg.query(
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
      ORDER BY ni.created_at DESC
      LIMIT 100
      `
    )

    res.status(200).json({
      count: result.rows.length,
      metrics: result.rows
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_delivery_metrics_query_failed" })
  }
})

export default router
