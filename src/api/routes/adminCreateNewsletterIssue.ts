import { Router } from "express";
import { pg } from "../infra/postgres.js";

const router = Router();

router.post("/newsletter-issues", async (req, res) => {
  try {
    const organizationId = String(req.body?.organizationId ?? "").trim();
    const title = String(req.body?.title ?? "").trim();
    const contentHtml = String(req.body?.contentHtml ?? "").trim();
    const status = String(req.body?.status ?? "draft").trim().toLowerCase();

    if (!organizationId) {
      res.status(400).json({ error: "organization_id_required" });
      return;
    }

    if (!title) {
      res.status(400).json({ error: "title_required" });
      return;
    }

    if (!contentHtml) {
      res.status(400).json({ error: "content_html_required" });
      return;
    }

    if (!["draft", "queued", "canceled", "sent"].includes(status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }

    const orgResult = await pg.query(
      `
      SELECT id
      FROM organizations
      WHERE id = $1
      LIMIT 1
      `,
      [organizationId]
    );

    if ((orgResult.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    const result = await pg.query(
      `
      INSERT INTO newsletter_issues (
        organization_id,
        title,
        content_html,
        status,
        created_at
      )
      VALUES ($1,$2,$3,$4,NOW())
      RETURNING id, organization_id, title, status, created_at
      `,
      [organizationId, title, contentHtml, status]
    );

    res.status(201).json({
      ok: true,
      issue: result.rows[0] ?? null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_newsletter_issue_create_failed" });
  }
});

export default router;
