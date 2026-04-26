/**
 * riskScale.ts — Org risk rating scale configuration
 *
 * Routes:
 *   GET /api/risk-scale           — get org's effective scale
 *   GET /api/risk-scale/presets   — list all built-in presets
 *   PUT /api/risk-scale           — update org scale (preset or custom labels)
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

const router = Router();

type RawLevel = {
  value: string;
  label: string;
  color: string;
  rank: number;
};

type RawPreset = {
  name: string;
  display_name: string;
  levels: RawLevel[];
};

function isPremium(req: any): boolean {
  const entitlement = req.apiKey?.entitlement_level ?? "";
  const norm = typeof entitlement === "string" ? entitlement.toLowerCase() : "";
  return norm === "premium" || norm === "platform" || norm === "team";
}

/* =========================================================
   GET /api/risk-scale
   Returns the org's effective scale. If custom_levels is set,
   returns that; otherwise returns the preset levels.
   ========================================================= */

router.get(
  "/risk-scale",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const orgCtx = (req as any).organizationContext ?? null;
    const organizationId = orgCtx?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const result = await pg.query<{
        preset_name: string;
        custom_levels: RawLevel[] | null;
        display_name: string;
        preset_levels: RawLevel[];
      }>(
        `
        SELECT
          COALESCE(ors.preset_name, 'standard')      AS preset_name,
          ors.custom_levels,
          rsp.display_name,
          rsp.levels                                  AS preset_levels
        FROM risk_scale_presets rsp
        LEFT JOIN organization_risk_scales ors
          ON ors.organization_id = $1
          AND ors.preset_name = rsp.name
        WHERE rsp.name = COALESCE(
          (SELECT preset_name FROM organization_risk_scales WHERE organization_id = $1),
          'standard'
        )
        `,
        [organizationId]
      );

      const row = result.rows[0];
      if (!row) {
        // Fallback: return the standard preset directly
        const fallback = await pg.query<RawPreset>(
          `SELECT name, display_name, levels FROM risk_scale_presets WHERE name = 'standard'`
        );
        const p = fallback.rows[0];
        res.status(200).json({
          preset_name:   "standard",
          display_name:  p?.display_name ?? "Standard",
          is_customized: false,
          levels:        (p?.levels ?? []) as RawLevel[],
        });
        return;
      }

      const levels = row.custom_levels ?? row.preset_levels;
      res.status(200).json({
        preset_name:   row.preset_name,
        display_name:  row.display_name,
        is_customized: row.custom_levels !== null,
        levels,
      });
    } catch (err) {
      logger.error({ event: "risk_scale_get_failed", err }, "GET /api/risk-scale failed");
      res.status(500).json({ error: "risk_scale_get_failed" });
    }
  }
);

/* =========================================================
   GET /api/risk-scale/presets
   Returns all 4 built-in presets.
   ========================================================= */

router.get(
  "/risk-scale/presets",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const orgCtx = (req as any).organizationContext ?? null;
    if (!orgCtx?.organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const result = await pg.query<RawPreset>(
        `SELECT name, display_name, levels FROM risk_scale_presets ORDER BY
           CASE name WHEN 'standard' THEN 1 WHEN 'nist' THEN 2 WHEN 'simple' THEN 3 ELSE 4 END`
      );

      const presets = result.rows.map((r) => ({
        preset_name:   r.name,
        display_name:  r.display_name,
        is_customized: false,
        levels:        r.levels as RawLevel[],
      }));

      res.status(200).json({ presets });
    } catch (err) {
      logger.error({ event: "risk_scale_presets_failed", err }, "GET /api/risk-scale/presets failed");
      res.status(500).json({ error: "risk_scale_presets_failed" });
    }
  }
);

/* =========================================================
   PUT /api/risk-scale
   Update the org's scale preset or custom label overrides.

   Body: { preset_name: string, custom_levels?: RawLevel[] }

   Rules:
   - Any standard org can change preset_name
   - custom_levels requires premium entitlement
   - custom_levels length must match the preset's level count
   ========================================================= */

router.put(
  "/risk-scale",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const orgCtx = (req as any).organizationContext ?? null;
    const organizationId = orgCtx?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const body = req.body as Record<string, unknown> | null;
    const presetName = typeof body?.preset_name === "string" ? body.preset_name.trim() : null;
    const customLevels = body?.custom_levels ?? null;

    if (!presetName) {
      res.status(400).json({ error: "preset_name_required" });
      return;
    }

    // Validate preset exists
    const presetResult = await pg.query<{ name: string; display_name: string; levels: RawLevel[] }>(
      `SELECT name, display_name, levels FROM risk_scale_presets WHERE name = $1`,
      [presetName]
    );

    const preset = presetResult.rows[0];
    if (!preset) {
      res.status(400).json({
        error: "invalid_preset_name",
        message: `Unknown preset '${presetName}'. Valid values: standard, nist, simple, custom.`,
      });
      return;
    }

    // custom_levels requires premium
    if (customLevels !== null && customLevels !== undefined) {
      if (!isPremium(req)) {
        res.status(403).json({
          error: "premium_required",
          message: "Custom label configuration requires a premium plan.",
        });
        return;
      }

      if (!Array.isArray(customLevels)) {
        res.status(400).json({ error: "custom_levels_must_be_array" });
        return;
      }

      const presetLevelCount = (preset.levels as RawLevel[]).length;
      if (customLevels.length !== presetLevelCount) {
        res.status(400).json({
          error: "custom_levels_length_mismatch",
          message: `custom_levels must have ${presetLevelCount} entries to match the '${presetName}' preset.`,
          expected: presetLevelCount,
          received: customLevels.length,
        });
        return;
      }

      // Validate each entry has required fields
      for (let i = 0; i < customLevels.length; i++) {
        const entry = customLevels[i] as Record<string, unknown>;
        if (
          typeof entry?.value !== "string" ||
          typeof entry?.label !== "string" ||
          typeof entry?.color !== "string"
        ) {
          res.status(400).json({
            error: "invalid_custom_level",
            message: `custom_levels[${i}] must have string fields: value, label, color`,
          });
          return;
        }
      }
    }

    try {
      const storedCustom = customLevels !== null && customLevels !== undefined
        ? JSON.stringify(customLevels)
        : null;

      await pg.query(
        `
        INSERT INTO organization_risk_scales (organization_id, preset_name, custom_levels, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (organization_id) DO UPDATE
          SET preset_name   = EXCLUDED.preset_name,
              custom_levels = EXCLUDED.custom_levels,
              updated_at    = NOW()
        `,
        [organizationId, presetName, storedCustom]
      );

      // Return the effective scale
      const effectiveLevels = customLevels !== null && customLevels !== undefined
        ? (customLevels as RawLevel[])
        : (preset.levels as RawLevel[]);

      res.status(200).json({
        preset_name:   presetName,
        display_name:  preset.display_name,
        is_customized: customLevels !== null && customLevels !== undefined,
        levels:        effectiveLevels,
      });
    } catch (err) {
      logger.error({ event: "risk_scale_put_failed", err }, "PUT /api/risk-scale failed");
      res.status(500).json({ error: "risk_scale_put_failed" });
    }
  }
);

export default router;
