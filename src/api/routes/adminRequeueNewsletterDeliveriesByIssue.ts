import { Router } from "express"
import { pg } from "../infra/postgres.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const router = Router()

router.post("/newsletter-issues/:id/requeue-deliveries", async (req, res) => {
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

    const issue = await pg.query(
      `
      SELECT id, status
      FROM newsletter_issues
      WHERE id = $1
      LIMIT 1
      `,
      [issueId]
    )

    if ((issue.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "newsletter_issue_not_found" })
      return
    }

    const result = await pg.query(
      `
      UPDATE newsletter_deliveries
      SET status = 'queued',
          retry_count = 0,
          last_error = NULL,
          next_attempt_at = NULL,
          dead_lettered_at = NULL
      WHERE issue_id = $1
        AND dead_lettered_at IS NOT NULL
      RETURNING id
      `,
      [issueId]
    )

    await pg.query(
      `
      UPDATE newsletter_issues
      SET status = 'queued',
          updated_at = NOW()
      WHERE id = $1
      `,
      [issueId]
    )

    res.status(200).json({
      ok: true,
      issueId,
      requeuedCount: result.rowCount ?? 0
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_requeue_newsletter_deliveries_failed" })
  }
})

export default router
