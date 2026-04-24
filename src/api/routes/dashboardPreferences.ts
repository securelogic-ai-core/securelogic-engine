import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

/* =========================================================
   Tile registry — the 12 valid tile IDs and the system default
   layout returned when no personal or org_default row exists.
   ========================================================= */

type TileConfig = {
  id: string;
  visible: boolean;
  order: number;
};

const SYSTEM_DEFAULT: TileConfig[] = [
  { id: "posture_score",       visible: true, order: 0  },
  { id: "risks_breakdown",     visible: true, order: 1  },
  { id: "risk_heatmap",        visible: true, order: 2  },
  { id: "posture_trend",       visible: true, order: 3  },
  { id: "findings_donut",      visible: true, order: 4  },
  { id: "domain_posture",      visible: true, order: 5  },
  { id: "actions_ring",        visible: true, order: 6  },
  { id: "open_items_aging",    visible: true, order: 7  },
  { id: "vendor_risk",         visible: true, order: 8  },
  { id: "framework_gaps",      visible: true, order: 9  },
  { id: "compliance_coverage", visible: true, order: 10 },
  { id: "inventory_grid",      visible: true, order: 11 },
];

const VALID_TILE_IDS = new Set(SYSTEM_DEFAULT.map((t) => t.id));

function validateLayout(raw: unknown): { ok: true; layout: TileConfig[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "layout_must_be_array" };
  }
  const layout: TileConfig[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      return { ok: false, error: "invalid_tile_entry" };
    }
    const { id, visible, order } = item as Record<string, unknown>;
    if (typeof id !== "string" || !VALID_TILE_IDS.has(id)) {
      return { ok: false, error: "invalid_tile_id" };
    }
    if (typeof visible !== "boolean") {
      return { ok: false, error: "invalid_visible_flag" };
    }
    if (typeof order !== "number" || !Number.isFinite(order)) {
      return { ok: false, error: "invalid_order" };
    }
    layout.push({ id, visible, order });
  }
  if (layout.filter((t) => t.visible).length === 0) {
    return { ok: false, error: "at_least_one_tile_required" };
  }
  return { ok: true, layout };
}

type PrefRow = {
  layout: TileConfig[];
  preference_type: string;
};

async function resolveLayout(
  organizationId: string,
  userId: string
): Promise<{ layout: TileConfig[]; source: "personal" | "org_default" | "system_default" }> {
  const personal = await pg.query<PrefRow>(
    `SELECT layout, preference_type FROM dashboard_preferences
     WHERE organization_id = $1 AND user_id = $2 AND preference_type = 'personal'
     LIMIT 1`,
    [organizationId, userId]
  );
  if (personal.rows.length > 0) {
    return { layout: personal.rows[0].layout, source: "personal" };
  }

  const orgDefault = await pg.query<PrefRow>(
    `SELECT layout, preference_type FROM dashboard_preferences
     WHERE organization_id = $1 AND user_id IS NULL AND preference_type = 'org_default'
     LIMIT 1`,
    [organizationId]
  );
  if (orgDefault.rows.length > 0) {
    return { layout: orgDefault.rows[0].layout, source: "org_default" };
  }

  return { layout: SYSTEM_DEFAULT, source: "system_default" };
}

/* =========================================================
   GET /api/dashboard/preferences
   Returns the caller's effective layout with its source.
   Resolution order: personal → org_default → system_default.
   ========================================================= */

router.get(
  "/dashboard/preferences",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      const userId = req.userId;
      const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
      if (!userId) {
        res.status(403).json({ error: "jwt_required" });
        return;
      }
      if (!organizationId) {
        res.status(400).json({ error: "organization_context_missing" });
        return;
      }

      const result = await resolveLayout(organizationId, userId);
      res.status(200).json(result);
    } catch (err) {
      logger.error({ event: "dashboard_prefs_get_failed", err }, "GET /api/dashboard/preferences failed");
      res.status(500).json({ error: "dashboard_prefs_get_failed" });
    }
  }
);

/* =========================================================
   PUT /api/dashboard/preferences
   Upsert the caller's personal layout.
   ========================================================= */

router.put(
  "/dashboard/preferences",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      const userId = req.userId;
      const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
      const apiKeyId = (req as any).apiKey?.id as string | undefined;
      if (!userId) {
        res.status(403).json({ error: "jwt_required" });
        return;
      }
      if (!organizationId) {
        res.status(400).json({ error: "organization_context_missing" });
        return;
      }

      const body = req.body as { layout?: unknown };
      const validated = validateLayout(body?.layout);
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }

      await pg.query(
        `INSERT INTO dashboard_preferences (organization_id, user_id, preference_type, layout)
         VALUES ($1, $2, 'personal', $3::jsonb)
         ON CONFLICT (organization_id, user_id) WHERE preference_type = 'personal'
         DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
        [organizationId, userId, JSON.stringify(validated.layout)]
      );

      const hiddenCount = validated.layout.filter((t) => !t.visible).length;
      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyId ?? null,
        actorUserId: userId,
        eventType: "dashboard.preferences_updated",
        resourceType: "dashboard_preference",
        payload: { tile_count: validated.layout.length, hidden_count: hiddenCount },
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({ layout: validated.layout, source: "personal" });
    } catch (err) {
      logger.error({ event: "dashboard_prefs_put_failed", err }, "PUT /api/dashboard/preferences failed");
      res.status(500).json({ error: "dashboard_prefs_put_failed" });
    }
  }
);

/* =========================================================
   DELETE /api/dashboard/preferences
   Remove the caller's personal row, reverting to org default
   (or system default if no org default is set).
   ========================================================= */

router.delete(
  "/dashboard/preferences",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      const userId = req.userId;
      const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
      const apiKeyId = (req as any).apiKey?.id as string | undefined;
      if (!userId) {
        res.status(403).json({ error: "jwt_required" });
        return;
      }
      if (!organizationId) {
        res.status(400).json({ error: "organization_context_missing" });
        return;
      }

      await pg.query(
        `DELETE FROM dashboard_preferences
         WHERE organization_id = $1 AND user_id = $2 AND preference_type = 'personal'`,
        [organizationId, userId]
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyId ?? null,
        actorUserId: userId,
        eventType: "dashboard.preferences_reset",
        resourceType: "dashboard_preference",
        ipAddress: req.ip ?? null,
      });

      const resolved = await resolveLayout(organizationId, userId);
      res.status(200).json(resolved);
    } catch (err) {
      logger.error({ event: "dashboard_prefs_delete_failed", err }, "DELETE /api/dashboard/preferences failed");
      res.status(500).json({ error: "dashboard_prefs_delete_failed" });
    }
  }
);

/* =========================================================
   GET /api/dashboard/preferences/org
   Return the org default layout, or the system default when
   none is set. Admin role required.
   ========================================================= */

router.get(
  "/dashboard/preferences/org",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      if (req.userRole !== "admin") {
        res.status(403).json({ error: "admin_required" });
        return;
      }
      const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
      if (!organizationId) {
        res.status(400).json({ error: "organization_context_missing" });
        return;
      }

      const result = await pg.query<PrefRow>(
        `SELECT layout, preference_type FROM dashboard_preferences
         WHERE organization_id = $1 AND user_id IS NULL AND preference_type = 'org_default'
         LIMIT 1`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        res.status(200).json({ layout: SYSTEM_DEFAULT, source: "system_default" });
        return;
      }
      res.status(200).json({ layout: result.rows[0].layout, source: "org_default" });
    } catch (err) {
      logger.error({ event: "dashboard_org_prefs_get_failed", err }, "GET /api/dashboard/preferences/org failed");
      res.status(500).json({ error: "dashboard_org_prefs_get_failed" });
    }
  }
);

/* =========================================================
   PUT /api/dashboard/preferences/org
   Admin-only. Upsert the org default layout (user_id = NULL).
   ========================================================= */

router.put(
  "/dashboard/preferences/org",
  requireApiKey,
  attachOrganizationContext,
  async (req, res) => {
    try {
      if (req.userRole !== "admin") {
        res.status(403).json({ error: "admin_required" });
        return;
      }
      const userId = req.userId;
      const organizationId = (req as any).organizationContext?.organizationId as string | undefined;
      const apiKeyId = (req as any).apiKey?.id as string | undefined;
      if (!organizationId) {
        res.status(400).json({ error: "organization_context_missing" });
        return;
      }

      const body = req.body as { layout?: unknown };
      const validated = validateLayout(body?.layout);
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }

      // Upsert keyed on the partial unique index
      // idx_dashboard_prefs_org_default (organization_id) WHERE
      // preference_type = 'org_default' AND user_id IS NULL. Postgres
      // requires the ON CONFLICT target to match that predicate exactly.
      await pg.query(
        `INSERT INTO dashboard_preferences (organization_id, user_id, preference_type, layout)
         VALUES ($1, NULL, 'org_default', $2::jsonb)
         ON CONFLICT (organization_id) WHERE preference_type = 'org_default' AND user_id IS NULL
         DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`,
        [organizationId, JSON.stringify(validated.layout)]
      );

      const hiddenCount = validated.layout.filter((t) => !t.visible).length;
      writeAuditEvent({
        organizationId,
        actorApiKeyId: apiKeyId ?? null,
        actorUserId: userId ?? null,
        eventType: "dashboard.org_preferences_updated",
        resourceType: "dashboard_preference",
        payload: { tile_count: validated.layout.length, hidden_count: hiddenCount },
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({ layout: validated.layout, source: "org_default" });
    } catch (err) {
      logger.error({ event: "dashboard_org_prefs_put_failed", err }, "PUT /api/dashboard/preferences/org failed");
      res.status(500).json({ error: "dashboard_org_prefs_put_failed" });
    }
  }
);

export default router;
