/**
 * orgSettings.ts — Customer-facing org security settings.
 *
 * Routes:
 *   GET   /api/org/settings  — read current org settings (requires JWT)
 *   PATCH /api/org/settings  — update org settings (requires JWT + admin role)
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdminRole } from "../middleware/requireRole.js";

const router = Router();

/* =========================================================
   GET /api/org/settings
   Returns org-level security settings for the caller's org.
   ========================================================= */

router.get("/org/settings", requireAuth, async (req, res) => {
  try {
    const orgId = req.jwtPayload!.org;

    const result = await pg.query<{ require_mfa: boolean }>(
      `SELECT require_mfa FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    res.status(200).json({ require_mfa: result.rows[0]!.require_mfa });
  } catch (err) {
    logger.error({ event: "org_settings_get_failed", err }, "GET /api/org/settings failed");
    res.status(500).json({ error: "fetch_failed" });
  }
});

/* =========================================================
   PATCH /api/org/settings
   Admin-only. Toggles require_mfa for the org.
   ========================================================= */

router.patch("/org/settings", requireAuth, requireAdminRole, async (req, res) => {
  try {
    const orgId   = req.jwtPayload!.org;
    const actorId = req.jwtPayload!.sub;

    const requireMfaRaw = req.body?.require_mfa;
    if (typeof requireMfaRaw !== "boolean") {
      res.status(400).json({ error: "invalid_require_mfa", expected: "boolean" });
      return;
    }

    const result = await pg.query<{ require_mfa: boolean }>(
      `UPDATE organizations
       SET require_mfa = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING require_mfa`,
      [requireMfaRaw, orgId]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    writeAuditEvent({
      organizationId: orgId,
      actorUserId:    actorId,
      eventType:      "org.mfa_policy_changed",
      resourceType:   "organization",
      resourceId:     orgId,
      payload:        { require_mfa: requireMfaRaw },
      ipAddress:      req.ip ?? null
    });

    logger.info({ event: "org_mfa_policy_changed", orgId, requireMfa: requireMfaRaw }, "Org MFA policy updated");

    res.status(200).json({ ok: true, require_mfa: result.rows[0]!.require_mfa });
  } catch (err) {
    logger.error({ event: "org_settings_patch_failed", err }, "PATCH /api/org/settings failed");
    res.status(500).json({ error: "update_failed" });
  }
});

export default router;
