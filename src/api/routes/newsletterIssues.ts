import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* =========================================================
   LIST ISSUES
   GET /api/newsletter-issues
   ========================================================= */

router.get(
  "/newsletter-issues",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const result = await pg.query(
        `
        SELECT
          id,
          organization_id,
          title,
          summary,
          sections_json,
          content_md,
          content_html,
          status,
          audience_tier,
          publish_date,
          created_at,
          updated_at
        FROM newsletter_issues
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 25
        `,
        [organizationId]
      );

      res.json({
        count: result.rows.length,
        organizationId: organizationContext?.organizationId ?? null,
        entitlementLevel: organizationContext?.entitlementLevel ?? null,
        issues: result.rows
      });
    } catch (err) {
      logger.error({ event: "newsletter_issues_list_failed", err }, "GET /api/newsletter-issues failed");
      res.status(500).json({ error: "newsletter_issues_query_failed" });
    }
  }
);

/* =========================================================
   GET ISSUE BY ID
   GET /api/newsletter-issues/:id
   ========================================================= */

router.get(
  "/newsletter-issues/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const id = String(req.params.id ?? "").trim();

      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "invalid_issue_id" });
        return;
      }

      const result = await pg.query(
        `
        SELECT
          id,
          organization_id,
          title,
          summary,
          sections_json,
          content_md,
          content_html,
          status,
          audience_tier,
          publish_date,
          created_at,
          updated_at
        FROM newsletter_issues
        WHERE id = $1
          AND organization_id = $2
        LIMIT 1
        `,
        [id, organizationId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "issue_not_found" });
        return;
      }

      res.json({ issue: result.rows[0] });
    } catch (err) {
      logger.error({ event: "newsletter_issue_get_failed", err }, "GET /api/newsletter-issues/:id failed");
      res.status(500).json({ error: "newsletter_issue_get_failed" });
    }
  }
);

export default router;
