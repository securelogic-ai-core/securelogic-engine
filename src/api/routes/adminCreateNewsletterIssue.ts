import { Router } from "express";
import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { capturePublicationContext } from "../lib/briefPublicationContext.js";

const router = Router();

const VALID_STATUSES = new Set(["draft", "queued", "canceled", "sent"]);
const VALID_AUDIENCE_TIERS = new Set(["free", "standard", "premium"]);

router.post("/newsletter-issues", async (req, res) => {
  try {
    // organizationId is optional — null creates a platform brief visible to all orgs
    const organizationIdRaw = req.body?.organizationId;
    const organizationId =
      organizationIdRaw && String(organizationIdRaw).trim()
        ? String(organizationIdRaw).trim()
        : null;

    const title = String(req.body?.title ?? "").trim();
    const summary = typeof req.body?.summary === "string" ? req.body.summary.trim() : null;
    const contentHtml = String(req.body?.contentHtml ?? "").trim();
    const contentMd = typeof req.body?.contentMd === "string" ? req.body.contentMd.trim() : null;
    const status = String(req.body?.status ?? "draft").trim().toLowerCase();
    const audienceTier = typeof req.body?.audienceTier === "string"
      ? req.body.audienceTier.trim().toLowerCase()
      : "free";
    const publishDate = typeof req.body?.publishDate === "string"
      ? req.body.publishDate.trim() || null
      : null;

    if (!title) {
      res.status(400).json({ error: "title_required" });
      return;
    }

    if (!contentHtml) {
      res.status(400).json({ error: "content_html_required" });
      return;
    }

    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ error: "invalid_status", valid: [...VALID_STATUSES] });
      return;
    }

    if (!VALID_AUDIENCE_TIERS.has(audienceTier)) {
      res.status(400).json({ error: "invalid_audience_tier", valid: [...VALID_AUDIENCE_TIERS] });
      return;
    }

    // If organizationId provided, verify it exists
    if (organizationId) {
      const orgResult = await pgElevated.query(
        `SELECT id FROM organizations WHERE id = $1 LIMIT 1`,
        [organizationId]
      );

      if ((orgResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "organization_not_found" });
        return;
      }
    }

    // Capture publication-time platform context when creating a sent issue with an org scope.
    // Returns null for platform-wide briefs (no org) or when no posture snapshot exists yet.
    const publicationContext =
      status === "sent" && organizationId !== null
        ? await withTenant(organizationId, () => capturePublicationContext(organizationId, pg))
        : null;

    const result = await pgElevated.query(
      `
      INSERT INTO newsletter_issues (
        organization_id,
        title,
        summary,
        content_html,
        content_md,
        status,
        audience_tier,
        publish_date,
        publication_context_json,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
      RETURNING id, organization_id, title, summary, status, audience_tier, publish_date, publication_context_json, created_at
      `,
      [organizationId, title, summary, contentHtml, contentMd, status, audienceTier, publishDate,
       publicationContext !== null ? JSON.stringify(publicationContext) : null]
    );

    res.status(201).json({
      ok: true,
      issue: result.rows[0] ?? null
    });
  } catch (err) {
    logger.error({ event: "admin_create_newsletter_issue_failed", err }, "POST /admin/newsletter-issues failed");
    res.status(500).json({ error: "admin_newsletter_issue_create_failed" });
  }
});

export default router;
