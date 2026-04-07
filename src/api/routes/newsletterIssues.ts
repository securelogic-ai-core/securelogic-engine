import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps the caller's entitlement_level to the set of audience_tier values
 * they may read in full.
 *
 * Tier hierarchy:
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

/**
 * Shape a raw DB row for the API response.
 *
 * If the caller's entitlement does not cover this issue's audience_tier,
 * the content fields are nulled out and locked:true is set. The issue
 * metadata (title, summary, dates) is always returned so the client can
 * render a teaser / upgrade prompt rather than a generic error.
 */
function shapeIssue(
  row: Record<string, unknown>,
  entitlementLevel: string | null
): Record<string, unknown> {
  const allowed = allowedAudienceTiers(entitlementLevel);
  const audienceTier =
    typeof row.audience_tier === "string" ? row.audience_tier : "free";
  const isLocked = !allowed.includes(audienceTier);

  if (isLocked) {
    return {
      id:              row.id,
      organization_id: row.organization_id,
      title:           row.title,
      summary:         row.summary,
      status:          row.status,
      audience_tier:   row.audience_tier,
      publish_date:    row.publish_date,
      created_at:      row.created_at,
      updated_at:      row.updated_at,
      locked:          true,
      content_html:    null,
      content_md:      null,
      sections_json:   null,
    };
  }

  return { ...row, locked: false };
}

/* =========================================================
   LIST ISSUES
   GET /api/newsletter-issues

   Returns all issues visible to the calling org (platform
   issues + org-owned). Free-tier callers receive full content
   only for issues with audience_tier = "free"; all other issues
   are returned with locked:true and content fields nulled.

   No minimum entitlement gate — any authenticated API key may
   browse the archive. Gating is applied per-issue via shapeIssue.
   ========================================================= */

router.get(
  "/newsletter-issues",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId;
      const entitlementLevel = organizationContext?.entitlementLevel ?? null;

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
        WHERE (organization_id = $1 OR organization_id IS NULL)
          AND status = 'sent'
        ORDER BY created_at DESC
        LIMIT 25
        `,
        [organizationId]
      );

      const issues = result.rows.map((row) => shapeIssue(row, entitlementLevel));

      res.json({
        count: issues.length,
        organizationId,
        entitlementLevel,
        issues,
      });
    } catch (err) {
      logger.error(
        { event: "newsletter_issues_list_failed", err },
        "GET /api/newsletter-issues failed"
      );
      res.status(500).json({ error: "newsletter_issues_query_failed" });
    }
  }
);

/* =========================================================
   GET ISSUE BY ID
   GET /api/newsletter-issues/:id

   Returns a single issue if it belongs to the calling org (or
   is a platform issue). Content fields are nulled and locked:true
   is set when the caller's entitlement does not cover the issue's
   audience_tier — the client receives enough metadata to render
   a locked state and upgrade prompt rather than a generic error.
   ========================================================= */

router.get(
  "/newsletter-issues/:id",
  requireApiKey,
  attachOrganizationContext,
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
          AND status = 'sent'
        LIMIT 1
        `,
        [id, organizationId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "issue_not_found" });
        return;
      }

      const issue = shapeIssue(result.rows[0], entitlementLevel);

      res.json({ issue });
    } catch (err) {
      logger.error(
        { event: "newsletter_issue_get_failed", err },
        "GET /api/newsletter-issues/:id failed"
      );
      res.status(500).json({ error: "newsletter_issue_get_failed" });
    }
  }
);

export default router;
