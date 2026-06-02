import { Router } from "express"
import { pgElevated } from "../infra/postgres.js"
import { logger } from "../infra/logger.js"
import { canPromoteIssue } from "../lib/newsletterLifecycle.js"

const router = Router()

router.post("/newsletter-issues/:id/promote", async (req, res) => {
  try {
    const issueId = String(req.params.id ?? "").trim()

    if (!issueId) {
      res.status(400).json({ error: "issue_id_required" })
      return
    }

    const issueResult = await pgElevated.query(
      `
      SELECT id, organization_id, title, status, content_html, created_at
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

    if (!canPromoteIssue(status)) {
      res.status(409).json({
        error: "invalid_issue_state_transition",
        from: status,
        to: "queued"
      })
      return
    }

    const contentHtml = String(issue.content_html ?? "").trim()

    if (!contentHtml) {
      res.status(400).json({ error: "content_html_required" })
      return
    }

    const subscriberResult = issue.organization_id
      ? await pgElevated.query(
          `SELECT COUNT(*)::int AS count FROM subscribers WHERE organization_id = $1 AND status = 'active'`,
          [issue.organization_id]
        )
      : await pgElevated.query(
          `SELECT COUNT(*)::int AS count FROM subscribers WHERE organization_id IS NULL AND status = 'active'`
        )

    const activeSubscriberCount = Number(subscriberResult.rows[0]?.count ?? 0)

    const updateResult = await pgElevated.query(
      `
      UPDATE newsletter_issues
      SET status = 'queued',
          updated_at = NOW()
      WHERE id = $1 AND status = 'draft'
      RETURNING id, organization_id, title, status, created_at
      `,
      [issueId]
    )

    // The issue existed and was 'draft' at the SELECT above, so the only way the
    // guarded UPDATE affects 0 rows is a concurrent promote flipping it out of
    // 'draft' between that read and this write (TOCTOU) — report the race, don't
    // silently return ok:true with a null issue.
    if ((updateResult.rowCount ?? 0) === 0) {
      res.status(409).json({
        error: "issue_state_changed",
        message: "Issue is no longer in draft state — likely promoted concurrently"
      })
      return
    }

    res.status(200).json({
      ok: true,
      activeSubscriberCount,
      issue: updateResult.rows[0] ?? null
    })
  } catch (err) {
    logger.error({ event: "admin_promote_newsletter_issue_failed", err }, "POST /admin/newsletter-issues/:id/promote failed")
    res.status(500).json({ error: "admin_newsletter_issue_promote_failed" })
  }
})

export default router
