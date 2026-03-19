import { Router } from "express"
import { pg } from "../infra/postgres.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const router = Router()

router.get("/delivery-metrics/issues/:id", async (req, res) => {
  try {
    const issueId = String(req.params.id ?? "").trim()

    if (!issueId) {
      res.status(400).json({ error: "issue_id_required" })
      return
    }

    if (!UUID_RE.test(issueId)) {
      res.status(400).json({ error: "invalid_issue_id" })
      return
    }

    const issueResult = await pg.query(
      `
      SELECT id, title, status, created_at
      FROM newsletter_issues
      WHERE id = $1
      LIMIT 1
      `,
      [issueId]
    )

    if ((issueResult.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "newsletter_issue_not_found" })
      return
    }

    const deliveryResult = await pg.query(
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
        created_at
      FROM newsletter_deliveries
      WHERE issue_id = $1
      ORDER BY created_at ASC
      `,
      [issueId]
    )

    res.status(200).json({
      issue: issueResult.rows[0],
      count: deliveryResult.rows.length,
      deliveries: deliveryResult.rows
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_issue_delivery_metrics_query_failed" })
  }
})

export default router
