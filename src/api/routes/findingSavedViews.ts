/**
 * findingSavedViews.ts — per-user named filter presets for the Findings decision
 * queue (ERIP §1 saved views). DARK behind SECURELOGIC_DECISION_WORKSPACE_ENABLED
 * (every route 404s while the flag is off — same two-switch posture as
 * /findings/:id/context).
 *
 *   GET    /api/finding-saved-views        — the caller's own views (org+user scoped)
 *   POST   /api/finding-saved-views        — create/rename-in-place by name {name, filters}
 *   DELETE /api/finding-saved-views/:id     — delete one of the caller's views
 *
 * Org- AND user-scoped on every query: organization_id from the request context and
 * user_id from the session identity (req.userId), never request input. A view is a
 * preference object (whitelisted filter strings), not a canonical domain object.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { normalizeSavedViewName, sanitizeSavedViewFilters } from "../lib/findingSavedViewValidation.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function flagOff(): boolean {
  return process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED !== "true";
}

function ctx(req: any): { organizationId: string | null; userId: string | null } {
  return {
    organizationId: req.organizationContext?.organizationId ?? null,
    userId: (req.userId as string | undefined) ?? null,
  };
}

const chain = [requireApiKey, attachOrganizationContext, requireEntitlement("premium"), denyContributor()];

/* GET /api/finding-saved-views — the caller's own saved views. */
router.get(
  "/finding-saved-views",
  ...chain,
  asTenant(async (req, res) => {
    try {
      if (flagOff()) {
        res.status(404).json({ error: "finding_saved_views_not_found" });
        return;
      }
      const { organizationId, userId } = ctx(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      if (!userId) {
        res.status(400).json({ error: "saved_views_require_user_identity" });
        return;
      }
      const rows = await pg.query(
        `SELECT id, name, filters, created_at, updated_at
           FROM finding_saved_views
          WHERE organization_id = $1 AND user_id = $2
          ORDER BY name ASC`,
        [organizationId, userId]
      );
      res.status(200).json({ views: rows.rows });
    } catch (err) {
      logger.error({ event: "finding_saved_views_list_failed", err }, "GET /api/finding-saved-views failed");
      res.status(500).json({ error: "finding_saved_views_failed" });
    }
  })
);

/* POST /api/finding-saved-views — create or rename-in-place by (org,user,name). */
router.post(
  "/finding-saved-views",
  ...chain,
  asTenant(async (req, res) => {
    try {
      if (flagOff()) {
        res.status(404).json({ error: "finding_saved_views_not_found" });
        return;
      }
      const { organizationId, userId } = ctx(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      if (!userId) {
        res.status(400).json({ error: "saved_views_require_user_identity" });
        return;
      }
      const name = normalizeSavedViewName((req.body ?? {}).name);
      if (!name) {
        res.status(400).json({ error: "saved_view_name_invalid" });
        return;
      }
      const filters = sanitizeSavedViewFilters((req.body ?? {}).filters);
      const upsert = await pg.query(
        `INSERT INTO finding_saved_views (organization_id, user_id, name, filters)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (organization_id, user_id, name)
         DO UPDATE SET filters = EXCLUDED.filters, updated_at = NOW()
         RETURNING id, name, filters, created_at, updated_at`,
        [organizationId, userId, name, JSON.stringify(filters)]
      );
      res.status(200).json({ view: upsert.rows[0] });
    } catch (err) {
      logger.error({ event: "finding_saved_views_create_failed", err }, "POST /api/finding-saved-views failed");
      res.status(500).json({ error: "finding_saved_views_failed" });
    }
  })
);

/* DELETE /api/finding-saved-views/:id — delete one of the caller's own views. */
router.delete(
  "/finding-saved-views/:id",
  ...chain,
  asTenant(async (req, res) => {
    try {
      if (flagOff()) {
        res.status(404).json({ error: "finding_saved_views_not_found" });
        return;
      }
      const { organizationId, userId } = ctx(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      if (!userId) {
        res.status(400).json({ error: "saved_views_require_user_identity" });
        return;
      }
      const id = String(req.params["id"] ?? "").trim();
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "saved_view_id_must_be_uuid" });
        return;
      }
      const del = await pg.query(
        `DELETE FROM finding_saved_views
          WHERE id = $1 AND organization_id = $2 AND user_id = $3
          RETURNING id`,
        [id, organizationId, userId]
      );
      if ((del.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "saved_view_not_found" });
        return;
      }
      res.status(200).json({ deleted: del.rows[0].id });
    } catch (err) {
      logger.error({ event: "finding_saved_views_delete_failed", err }, "DELETE /api/finding-saved-views/:id failed");
      res.status(500).json({ error: "finding_saved_views_failed" });
    }
  })
);

export default router;
