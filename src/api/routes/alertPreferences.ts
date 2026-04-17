import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

/* =========================================================
   GET /api/alert-preferences
   Return current alert preferences for the authenticated user.
   Defaults to all-true when no row exists.
   ========================================================= */

router.get(
  "/alert-preferences",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      const userId: string | undefined = (req as any).userId;
      if (!userId) {
        res.status(403).json({ error: "jwt_required" });
        return;
      }

      const result = await pg.query<{
        critical_finding_immediate: boolean;
        high_finding_immediate: boolean;
        daily_digest: boolean;
        weekly_summary: boolean;
      }>(
        `SELECT critical_finding_immediate, high_finding_immediate, daily_digest, weekly_summary
         FROM user_alert_preferences
         WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        res.status(200).json({
          preferences: {
            critical_finding_immediate: true,
            high_finding_immediate: true,
            daily_digest: true,
            weekly_summary: true,
          },
        });
        return;
      }

      res.status(200).json({ preferences: result.rows[0] });
    } catch (err) {
      logger.error({ event: "alert_prefs_get_failed", err }, "GET /api/alert-preferences failed");
      res.status(500).json({ error: "alert_prefs_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/alert-preferences
   Upsert alert preferences for the authenticated user.
   ========================================================= */

const BOOLEAN_FIELDS = new Set([
  "critical_finding_immediate",
  "high_finding_immediate",
  "daily_digest",
  "weekly_summary",
]);

router.patch(
  "/alert-preferences",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      const userId: string | undefined = (req as any).userId;
      if (!userId) {
        res.status(403).json({ error: "jwt_required" });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const updates: Record<string, boolean> = {};

      for (const [key, val] of Object.entries(body)) {
        if (!BOOLEAN_FIELDS.has(key)) continue;
        if (typeof val !== "boolean") {
          res.status(400).json({ error: "invalid_value", field: key });
          return;
        }
        updates[key] = val;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "no_valid_fields" });
        return;
      }

      const setClauses = Object.keys(updates)
        .map((k, i) => `${k} = $${i + 2}`)
        .join(", ");
      const values = [userId, ...Object.values(updates)];

      await pg.query(
        `INSERT INTO user_alert_preferences (user_id, ${Object.keys(updates).join(", ")})
         VALUES ($1, ${Object.keys(updates).map((_, i) => `$${i + 2}`).join(", ")})
         ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
        values
      );

      const result = await pg.query<{
        critical_finding_immediate: boolean;
        high_finding_immediate: boolean;
        daily_digest: boolean;
        weekly_summary: boolean;
      }>(
        `SELECT critical_finding_immediate, high_finding_immediate, daily_digest, weekly_summary
         FROM user_alert_preferences WHERE user_id = $1`,
        [userId]
      );

      res.status(200).json({ preferences: result.rows[0] });
    } catch (err) {
      logger.error({ event: "alert_prefs_patch_failed", err }, "PATCH /api/alert-preferences failed");
      res.status(500).json({ error: "alert_prefs_patch_failed" });
    }
  }
);

export default router;
