import { Router } from "express"
import { pg } from "../infra/postgres.js"
import { canCancelIssue } from "../lib/newsletterLifecycle.js"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const router = Router()

router.post("/newsletter-issues/:id/cancel", async (req, res) => {
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
      SELECT id, organization_id, title, status, created_at
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

    const issue = issueResult.rows[0]
    const status = String(issue.status ?? "")

    if (status === "sent") {
      res.status(409).json({ error: "newsletter_issue_already_sent" })
      return
    }

    if (!canCancelIssue(status)) {
      res.status(409).json({
        error: "invalid_issue_state_transition",
        from: status,
        to: "canceled"
      })
      return
    }

    const updateResult = await pg.query(
      `
      UPDATE newsletter_issues
      SET status = 'canceled',
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, organization_id, title, status, created_at
      `,
      [issueId]
    )

    await pg.query(
      `
      UPDATE newsletter_deliveries
      SET status = 'failed'
      WHERE issue_id = $1
        AND status = 'queued'
      `,
      [issueId]
    )

    res.status(200).json({
      ok: true,
      issue: updateResult.rows[0] ?? null
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "admin_newsletter_issue_cancel_failed" })
  }
})

export default router
