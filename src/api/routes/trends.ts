import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

router.get(
  "/trends",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const result = await pg.query(
        `
        SELECT
          id,
          organization_id,
          name,
          category,
          description,
          score,
          window_start,
          window_end,
          metadata,
          created_at
        FROM trends
        WHERE organization_id = $1
        ORDER BY score DESC, created_at DESC
        LIMIT 50
        `,
        [organizationId]
      );

      res.json({
        count: result.rows.length,
        organizationId: organizationContext?.organizationId ?? null,
        entitlementLevel: organizationContext?.entitlementLevel ?? null,
        trends: result.rows
      });
    } catch (err) {
      console.error("trends_api_error", err);

      res.status(500).json({
        error: "trends_query_failed"
      });
    }
  }
);

export default router;
