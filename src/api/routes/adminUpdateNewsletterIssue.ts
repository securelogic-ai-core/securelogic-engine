import { Router } from "express";
import { pg } from "../infra/postgres.js";

const router = Router();

router.patch("/newsletter-issues/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();

    if (!id) {
      res.status(400).json({ error: "issue_id_required" });
      return;
    }

    const existingResult = await pg.query(
      `
      SELECT
        id,
        organization_id,
        title,
        content_html,
        status,
        created_at
      FROM newsletter_issues
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if ((existingResult.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "newsletter_issue_not_found" });
      return;
    }

    const existing = existingResult.rows[0];

    const nextTitle =
      typeof req.body?.title === "string"
        ? req.body.title.trim()
        : existing.title;

    const nextContentHtml =
      typeof req.body?.contentHtml === "string"
        ? req.body.contentHtml.trim()
        : existing.content_html;

    const nextStatus =
      typeof req.body?.status === "string"
        ? req.body.status.trim().toLowerCase()
        : existing.status;

    if (!nextTitle) {
      res.status(400).json({ error: "title_required" });
      return;
    }

    if (!nextContentHtml) {
      res.status(400).json({ error: "content_html_required" });
      return;
    }

    if (!["draft", "queued", "canceled", "sent"].includes(nextStatus)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }

    const result = await pg.query(
      `
      UPDATE newsletter_issues
      SET
        title = $2,
        content_html = $3,
        status = $4
      WHERE id = $1
      RETURNING
        id,
        organization_id,
        title,
        content_html,
        status,
        created_at
      `,
      [id, nextTitle, nextContentHtml, nextStatus]
    );

    res.status(200).json({
      ok: true,
      issue: result.rows[0] ?? null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_newsletter_issue_update_failed" });
  }
});

export default router;
