import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* =========================================================
   GET /api/intelligence

   Returns the 10 most recent newsletter issues visible to
   the calling org: platform issues (org IS NULL) + org-owned.
   Ordered newest-first.
   ========================================================= */

router.get("/intelligence", async (req, res, next) => {
  try {
    const orgId =
      (req as any).organizationContext?.organizationId ?? null;

    const result = await pg.query(
      `
      SELECT id, title, status, audience_tier, created_at
      FROM newsletter_issues
      WHERE (organization_id IS NOT DISTINCT FROM $1 OR organization_id IS NULL)
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [orgId]
    );

    res.json(result.rows);
  } catch (err) {
    logger.error({ event: "intelligence_list_failed", err }, "GET /api/intelligence failed");
    next(err);
  }
});

/* =========================================================
   GET /api/intelligence/latest

   Returns the single most recent newsletter issue visible
   to the calling org.
   ========================================================= */

router.get("/intelligence/latest", async (req, res, next) => {
  try {
    const orgId =
      (req as any).organizationContext?.organizationId ?? null;

    const result = await pg.query(
      `
      SELECT id, title, status, audience_tier, summary, content_html, content_md,
             sections_json, publish_date, created_at, updated_at
      FROM newsletter_issues
      WHERE (organization_id IS NOT DISTINCT FROM $1 OR organization_id IS NULL)
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ event: "intelligence_latest_failed", err }, "GET /api/intelligence/latest failed");
    next(err);
  }
});

/* =========================================================
   GET /api/intelligence/:id

   Returns a single newsletter issue by UUID, scoped to the
   calling org. Returns 404 if the issue belongs to a
   different org or does not exist.
   ========================================================= */

router.get("/intelligence/:id", async (req, res, next) => {
  try {
    const id = req.params["id"];

    if (!isValidUuid(id)) {
      res.status(400).json({ error: "invalid_issue_id" });
      return;
    }

    const orgId =
      (req as any).organizationContext?.organizationId ?? null;

    const result = await pg.query(
      `
      SELECT id, title, status, audience_tier, summary, content_html, content_md,
             sections_json, publish_date, created_at, updated_at
      FROM newsletter_issues
      WHERE id = $1
        AND (organization_id IS NOT DISTINCT FROM $2 OR organization_id IS NULL)
      LIMIT 1
      `,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ event: "intelligence_get_failed", err }, "GET /api/intelligence/:id failed");
    next(err);
  }
});

export default router;
