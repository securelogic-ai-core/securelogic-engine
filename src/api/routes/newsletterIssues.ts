import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps the caller's entitlement_level to the set of audience_tier values
 * they are permitted to see.
 *
 * Tier hierarchy (consistent with requireEntitlement rank order):
 *   premium  → free + standard + premium
 *   standard → free + standard
 *   starter  → free only
 */
function allowedAudienceTiers(entitlementLevel: string | null): string[] {
  switch (entitlementLevel?.toLowerCase()) {
    case "premium":  return ["free", "standard", "premium"];
    case "standard": return ["free", "standard"];
    default:         return ["free"]; // starter or unrecognised
  }
}

/* =========================================================
   LIST ISSUES
   GET /api/newsletter-issues

   Returns issues visible to the calling org, filtered by the
   caller's entitlement level. Platform issues (organization_id
   IS NULL) are visible to all authenticated callers whose tier
   permits the issue's audience_tier.
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
      const entitlementLevel = organizationContext?.entitlementLevel ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const tiers = allowedAudienceTiers(entitlementLevel);

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
        WHERE (organization_id = $1 OR organization_id IS NULL)
          AND audience_tier = ANY($2::text[])
        ORDER BY created_at DESC
        LIMIT 25
        `,
        [organizationId, tiers]
      );

      res.json({
        count: result.rows.length,
        organizationId,
        entitlementLevel,
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

   Returns a single issue if it belongs to the calling org (or
   is a platform issue) AND its audience_tier is permitted by
   the caller's entitlement level. Returns 404 if the issue
   exists but the caller's tier does not permit access — avoids
   leaking the existence of premium content to lower-tier callers.
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
      const entitlementLevel = organizationContext?.entitlementLevel ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const id = String(req.params.id ?? "").trim();

      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "invalid_issue_id" });
        return;
      }

      const tiers = allowedAudienceTiers(entitlementLevel);

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
          AND (organization_id = $2 OR organization_id IS NULL)
          AND audience_tier = ANY($3::text[])
        LIMIT 1
        `,
        [id, organizationId, tiers]
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
