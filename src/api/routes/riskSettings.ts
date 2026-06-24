/**
 * riskSettings.ts — Org-level risk policy (RR-5).
 *
 * Currently exposes only the review-cadence policy by residual rating.
 * The shape is a forward-room: future RR-N items (acceptance workflow,
 * escalation, KRIs) can extend this table without renaming.
 *
 * ROUTES
 *   GET /api/orgs/me/risk-settings  — read effective policy. When no row
 *                                      exists for the org, returns the
 *                                      documented defaults with
 *                                      is_default=true. Always returns
 *                                      all four rating keys.
 *   PUT /api/orgs/me/risk-settings  — upsert the org's policy.
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never
 *     from the request body.
 *   - PUT body validated structurally (all four ratings required,
 *     positive integers ≤ MAX_DAYS) before any DB write.
 *   - Audit-log every PUT via writeAuditEvent.
 *
 * HANDLERS ARE NAMED EXPORTS so behavioral tests can drive them with
 * mocked pg — same pattern as riskScoringWeights.ts.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { DEFAULT_CADENCE_BY_RATING, VALID_RATINGS } from "../lib/riskCadence.js";
import { validateRiskSettingsPut } from "../lib/riskSettingsValidation.js";

const router = Router();

const SETTINGS_SELECT = `
  id,
  organization_id,
  cadence_by_rating,
  created_at,
  updated_at,
  updated_by_user_id
`;

function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

/**
 * Merge the org's stored policy (if any) over the documented defaults.
 * Always returns all four rating keys. Exported for testability.
 */
export function buildEffectiveCadenceByRating(
  stored: Record<string, unknown> | null
): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_CADENCE_BY_RATING };
  if (!stored || typeof stored !== "object") return out;
  for (const rating of VALID_RATINGS) {
    const v = stored[rating];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) {
      out[rating] = v;
    }
  }
  return out;
}

/* =========================================================
   GET /api/orgs/me/risk-settings
   ========================================================= */

export async function getRiskSettings(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  try {
    const result = await pg.query(
      `SELECT ${SETTINGS_SELECT}
         FROM risk_settings
        WHERE organization_id = $1
        LIMIT 1`,
      [organizationId]
    );

    if ((result.rowCount ?? 0) === 0) {
      // No row yet — surface defaults so the client always renders four
      // values. is_default=true tells the UI "this came from code, not
      // from a configured org policy."
      res.status(200).json({
        is_default: true,
        organization_id: organizationId,
        cadence_by_rating: { ...DEFAULT_CADENCE_BY_RATING },
        created_at: null,
        updated_at: null,
        updated_by_user_id: null
      });
      return;
    }

    const row = result.rows[0]!;
    res.status(200).json({
      is_default: false,
      organization_id: organizationId,
      cadence_by_rating: buildEffectiveCadenceByRating(
        (row.cadence_by_rating as Record<string, unknown> | null) ?? null
      ),
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by_user_id: row.updated_by_user_id
    });
  } catch (err) {
    logger.error(
      { event: "risk_settings_get_failed", err },
      "GET /api/orgs/me/risk-settings failed"
    );
    res.status(500).json({ error: "risk_settings_get_failed" });
  }
}

/* =========================================================
   PUT /api/orgs/me/risk-settings
   ========================================================= */

export async function putRiskSettings(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const validated = validateRiskSettingsPut(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  const { cadence_by_rating } = validated.input;
  const userId = req.userId ?? null;

  try {
    // SELECT-before-write: capture the prior effective policy so the
    // audit payload can emit a per-key { before, after } diff. When no
    // row exists yet, "before" is the documented effective-defaults
    // map — that's the policy the org was actually operating under,
    // and recording it makes the very first PUT auditable as a real
    // change rather than a black box.
    const beforeResult = await pg.query<{
      cadence_by_rating: Record<string, unknown> | null;
    }>(
      `SELECT cadence_by_rating
         FROM risk_settings
        WHERE organization_id = $1
        LIMIT 1`,
      [organizationId]
    );
    const beforeMap = buildEffectiveCadenceByRating(
      (beforeResult.rows[0]?.cadence_by_rating as Record<string, unknown> | null) ?? null
    );

    const result = await pg.query(
      `INSERT INTO risk_settings (
         organization_id, cadence_by_rating, updated_by_user_id
       )
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (organization_id) DO UPDATE
         SET cadence_by_rating  = EXCLUDED.cadence_by_rating,
             updated_at         = NOW(),
             updated_by_user_id = EXCLUDED.updated_by_user_id
       RETURNING ${SETTINGS_SELECT}`,
      [organizationId, JSON.stringify(cadence_by_rating), userId]
    );

    const row = result.rows[0]!;
    const afterMap = buildEffectiveCadenceByRating(
      (row.cadence_by_rating as Record<string, unknown> | null) ?? null
    );

    // Build per-rating diff in the { before: {...}, after: {...} } shape
    // matching the rest of the audit-log family (see PATCH /api/risks
    // diffs in src/api/routes/risks.ts). Only include rating keys whose
    // value actually changed; keeps the payload focused on the delta.
    const cadence_diff: {
      before: Record<string, number>;
      after: Record<string, number>;
    } = { before: {}, after: {} };
    for (const rating of VALID_RATINGS) {
      if (beforeMap[rating] !== afterMap[rating]) {
        cadence_diff.before[rating] = beforeMap[rating]!;
        cadence_diff.after[rating]  = afterMap[rating]!;
      }
    }

    logger.info(
      {
        event: "risk_settings_updated",
        organizationId,
        rowId: row.id
      },
      "Risk settings updated"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId:   userId,
      eventType:     "risk_settings.updated",
      resourceType:  "risk_settings",
      resourceId:    row.id as string,
      payload:       {
        cadence_by_rating,
        cadence_diff
      },
      ipAddress:     req.ip ?? null
    });

    res.status(200).json({
      is_default: false,
      organization_id: organizationId,
      cadence_by_rating: buildEffectiveCadenceByRating(
        (row.cadence_by_rating as Record<string, unknown> | null) ?? null
      ),
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by_user_id: row.updated_by_user_id
    });
  } catch (err) {
    logger.error(
      { event: "risk_settings_put_failed", err },
      "PUT /api/orgs/me/risk-settings failed"
    );
    res.status(500).json({ error: "risk_settings_put_failed" });
  }
}

router.get(
  "/orgs/me/risk-settings",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(getRiskSettings)
);

router.put(
  "/orgs/me/risk-settings",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(putRiskSettings)
);

export default router;
