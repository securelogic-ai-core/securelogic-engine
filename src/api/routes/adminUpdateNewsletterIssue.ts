import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { capturePublicationContext } from "../lib/briefPublicationContext.js";

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
        publication_context_json,
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

    // Capture publication-time platform context when transitioning to 'sent' for
    // the first time. Preserve existing context on status-preserving updates.
    const isNewSentTransition = nextStatus === "sent" && existing.status !== "sent";
    const orgId: string | null = existing.organization_id ?? null;

    let resolvedPublicationContext: string | null;
    if (isNewSentTransition && orgId !== null) {
      const captured = await capturePublicationContext(orgId, pg);
      resolvedPublicationContext = captured !== null ? JSON.stringify(captured) : null;
    } else if (existing.status === "sent") {
      // Already published — preserve the stored context, do not overwrite
      resolvedPublicationContext = existing.publication_context_json !== null
        ? JSON.stringify(existing.publication_context_json)
        : null;
    } else {
      resolvedPublicationContext = null;
    }

    const result = await pg.query(
      `
      UPDATE newsletter_issues
      SET
        title = $2,
        content_html = $3,
        status = $4,
        publication_context_json = $5
      WHERE id = $1
      RETURNING
        id,
        organization_id,
        title,
        content_html,
        status,
        publication_context_json,
        created_at
      `,
      [id, nextTitle, nextContentHtml, nextStatus, resolvedPublicationContext]
    );

    res.status(200).json({
      ok: true,
      issue: result.rows[0] ?? null
    });
  } catch (err) {
    logger.error({ event: "admin_update_newsletter_issue_failed", err }, "PATCH /admin/newsletter-issues/:id failed");
    res.status(500).json({ error: "admin_newsletter_issue_update_failed" });
  }
});

export default router;
