/**
 * briefingLayouts.ts — per-user Briefing layout persistence (Briefing
 * Initiative B2: Role-Aware Defaults & Personalization). DARK behind
 * SECURELOGIC_DASHBOARD_BRIEFING_ENABLED (engine half of the two-switch model;
 * every route 404s while the flag is off — the findingSavedViews posture).
 *
 *   GET    /api/briefing/layout — the caller's saved layout envelope, or null
 *   PUT    /api/briefing/layout — validate + upsert the caller's layout
 *   DELETE /api/briefing/layout — reset: return to the UNSAVED state (the app
 *          re-derives legacy projection or role default; spec ruling C2)
 *
 * Org- AND user-scoped on every query: organization_id from the request context
 * and user_id from the session identity (req.userId), never request input.
 * Exactly ONE layout per (org, user) in B2 (briefing_layouts_one_per_user).
 * The envelope is validated by the pure lib against the GENERATED engine module
 * manifest — never the client catalog. Eligibility is deliberately NOT
 * validated on write (render-time concern; a stored layout never grants
 * access). A layout is a preference object, not a canonical domain object.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireNotViewer } from "../middleware/requireRole.js";
import { asTenant } from "../middleware/asTenant.js";
import { validateBriefingLayoutEnvelope } from "../lib/briefingLayoutValidation.js";

const router = Router();

function flagOff(): boolean {
  return process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED !== "true";
}

function ctx(req: any): { organizationId: string | null; userId: string | null } {
  return {
    organizationId: req.organizationContext?.organizationId ?? null,
    userId: (req.userId as string | undefined) ?? null,
  };
}

const chain = [requireApiKey, attachOrganizationContext, requireEntitlement("premium"), denyContributor()];

/* GET /api/briefing/layout — the caller's saved layout, or {layout: null}. */
router.get(
  "/briefing/layout",
  ...chain,
  asTenant(async (req, res) => {
    try {
      if (flagOff()) {
        res.status(404).json({ error: "briefing_layout_not_found" });
        return;
      }
      const { organizationId, userId } = ctx(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      if (!userId) {
        res.status(400).json({ error: "briefing_layout_requires_user_identity" });
        return;
      }
      const rows = await pg.query(
        `SELECT layout, updated_at
           FROM briefing_layouts
          WHERE organization_id = $1 AND user_id = $2
          LIMIT 1`,
        [organizationId, userId]
      );
      const row = rows.rows[0];
      res.status(200).json({
        layout: row?.layout ?? null,
        updated_at: row?.updated_at ?? null,
      });
    } catch (err) {
      logger.error({ event: "briefing_layout_get_failed", err }, "GET /api/briefing/layout failed");
      res.status(500).json({ error: "briefing_layout_failed" });
    }
  })
);

/* PUT /api/briefing/layout — validate + upsert the caller's layout envelope. */
router.put(
  "/briefing/layout",
  ...chain,
  requireNotViewer,
  asTenant(async (req, res) => {
    try {
      if (flagOff()) {
        res.status(404).json({ error: "briefing_layout_not_found" });
        return;
      }
      const { organizationId, userId } = ctx(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      if (!userId) {
        res.status(400).json({ error: "briefing_layout_requires_user_identity" });
        return;
      }
      const validated = validateBriefingLayoutEnvelope((req.body ?? {}).layout);
      if ("error" in validated) {
        res.status(400).json(validated);
        return;
      }
      const { input } = validated;
      const upsert = await pg.query(
        `INSERT INTO briefing_layouts (organization_id, user_id, layout)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (organization_id, user_id)
         DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()
         RETURNING layout, updated_at`,
        [organizationId, userId, JSON.stringify(input)]
      );
      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: userId,
        eventType: "briefing.layout_updated",
        resourceType: "briefing_layout",
        resourceId: null,
        payload: { module_count: input.modules.length },
        ipAddress: req.ip ?? null,
      });
      res.status(200).json({
        layout: upsert.rows[0].layout,
        updated_at: upsert.rows[0].updated_at,
      });
    } catch (err) {
      logger.error({ event: "briefing_layout_put_failed", err }, "PUT /api/briefing/layout failed");
      res.status(500).json({ error: "briefing_layout_failed" });
    }
  })
);

/* DELETE /api/briefing/layout — idempotent reset to the unsaved state. */
router.delete(
  "/briefing/layout",
  ...chain,
  requireNotViewer,
  asTenant(async (req, res) => {
    try {
      if (flagOff()) {
        res.status(404).json({ error: "briefing_layout_not_found" });
        return;
      }
      const { organizationId, userId } = ctx(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      if (!userId) {
        res.status(400).json({ error: "briefing_layout_requires_user_identity" });
        return;
      }
      const del = await pg.query(
        `DELETE FROM briefing_layouts
          WHERE organization_id = $1 AND user_id = $2
          RETURNING id`,
        [organizationId, userId]
      );
      if ((del.rowCount ?? 0) > 0) {
        writeAuditEvent({
          organizationId,
          actorApiKeyId: (req as any).apiKey?.id ?? null,
          actorUserId: userId,
          eventType: "briefing.layout_reset",
          resourceType: "briefing_layout",
          resourceId: del.rows[0].id,
          payload: {},
          ipAddress: req.ip ?? null,
        });
      }
      res.status(200).json({ reset: true });
    } catch (err) {
      logger.error({ event: "briefing_layout_delete_failed", err }, "DELETE /api/briefing/layout failed");
      res.status(500).json({ error: "briefing_layout_failed" });
    }
  })
);

export default router;
