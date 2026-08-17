/**
 * orgSettings.ts — Customer-facing organization settings & profile.
 *
 * Routes:
 *   GET   /api/org/settings  — read org settings + risk-context profile (JWT)
 *   PATCH /api/org/settings  — partial update (JWT + admin role)
 *
 * The profile fields (`regulated`, `handles_pii`, `safety_critical`, `scale`)
 * feed context-weighted risk scoring, finding enterprise context, and posture
 * computation. This route is the CUSTOMER write path for them — before it,
 * only the operator admin API could set them, so customer orgs sat at
 * defaults and the weighting never applied. `name` is the organization's
 * display identity (team invites, briefs, reports). `require_mfa` is the
 * org-wide authentication policy (the original single field here).
 *
 * PATCH is a partial update: any validated subset applies atomically in one
 * UPDATE; unknown fields 400 (validateOrgSettingsPatch). Every change writes
 * one audit event carrying exactly the fields that changed.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { asTenant } from "../middleware/asTenant.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdminRole } from "../middleware/requireRole.js";
import {
  validateOrgSettingsPatch,
  type OrgSettingsPatch,
} from "../lib/orgSettingsValidation.js";

const router = Router();

const SETTINGS_SELECT = `name, require_mfa, regulated, handles_pii, safety_critical, scale, voice_input_enabled`;

interface OrgSettingsRow {
  name: string;
  require_mfa: boolean;
  regulated: boolean;
  handles_pii: boolean;
  safety_critical: boolean;
  scale: string;
  voice_input_enabled: boolean;
}

/* =========================================================
   GET /api/org/settings
   Returns org-level settings + risk-context profile.
   ========================================================= */

router.get("/org/settings", requireAuth, asTenant(async (req, res) => {
  try {
    const orgId = req.jwtPayload!.org;

    const result = await pg.query<OrgSettingsRow>(
      `SELECT ${SETTINGS_SELECT} FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    res.status(200).json(result.rows[0]!);
  } catch (err) {
    logger.error({ event: "org_settings_get_failed", err }, "GET /api/org/settings failed");
    res.status(500).json({ error: "fetch_failed" });
  }
}));

/* =========================================================
   PATCH /api/org/settings
   Admin-only. Partial update of name / require_mfa / risk-context profile.
   ========================================================= */

/** Column allow-list — patch keys map 1:1 onto these columns and nothing else. */
const PATCHABLE_COLUMNS: ReadonlyArray<keyof OrgSettingsPatch> = [
  "name",
  "require_mfa",
  "regulated",
  "handles_pii",
  "safety_critical",
  "scale",
  "voice_input_enabled",
];

router.patch("/org/settings", requireAuth, requireAdminRole, asTenant(async (req, res) => {
  try {
    const orgId   = req.jwtPayload!.org;
    const actorId = req.jwtPayload!.sub;

    const validated = validateOrgSettingsPatch(req.body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error, detail: validated.detail });
      return;
    }
    const patch = validated.patch;

    // Dynamic SET over the closed allow-list only — patch keys are validator
    // output, never raw client keys, so no user input reaches an identifier.
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const col of PATCHABLE_COLUMNS) {
      if (col in patch) {
        values.push(patch[col]);
        sets.push(`${col} = $${values.length}`);
      }
    }
    values.push(orgId);

    const result = await pg.query<OrgSettingsRow>(
      `UPDATE organizations
          SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING ${SETTINGS_SELECT}`,
      values
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    // One audit event per change, carrying exactly the fields that changed.
    // require_mfa keeps its historical dedicated event type so existing audit
    // consumers/alerts on org.mfa_policy_changed keep working; everything
    // else lands under org.settings_changed.
    const mfaOnly = "require_mfa" in patch && Object.keys(patch).length === 1;
    writeAuditEvent({
      organizationId: orgId,
      actorUserId:    actorId,
      eventType:      mfaOnly ? "org.mfa_policy_changed" : "org.settings_changed",
      resourceType:   "organization",
      resourceId:     orgId,
      payload:        { ...patch },
      ipAddress:      req.ip ?? null
    });

    logger.info(
      { event: "org_settings_changed", orgId, fields: Object.keys(patch) },
      "Org settings updated"
    );

    res.status(200).json({ ok: true, ...result.rows[0]! });
  } catch (err) {
    logger.error({ event: "org_settings_patch_failed", err }, "PATCH /api/org/settings failed");
    res.status(500).json({ error: "update_failed" });
  }
}));

export default router;
