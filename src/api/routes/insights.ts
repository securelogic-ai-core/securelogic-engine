import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

router.get(
  "/insights",
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
          signal_id,
          organization_id,
          title,
          analysis,
          risk_implication,
          recommendation,
          risk_level,
          audience,
          published,
          linked_sources,
          created_at,
          updated_at
        FROM insights
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 50
        `,
        [organizationId]
      );

      res.json({
        count: result.rows.length,
        organizationId: organizationContext?.organizationId ?? null,
        entitlementLevel: organizationContext?.entitlementLevel ?? null,
        insights: result.rows
      });
    } catch (err) {
      console.error("insights_api_error", err);

      res.status(500).json({
        error: "insights_query_failed"
      });
    }
  }
);

export default router;
