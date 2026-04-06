import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

router.get(
  "/signals",
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
          title,
          category,
          source,
          published_at,
          impact_score,
          novelty_score,
          relevance_score,
          priority,
          processed,
          created_at
        FROM signals
        WHERE (organization_id = $1 OR organization_id IS NULL)
        ORDER BY created_at DESC
        LIMIT 50
        `,
        [organizationId]
      );

      res.json({
        count: result.rows.length,
        organizationId,
        signals: result.rows
      });
    } catch (err) {
      logger.error({ event: "signals_api_error", err }, "GET /api/signals failed");

      res.status(500).json({
        error: "signals_query_failed"
      });
    }
  }
);

export default router;
