import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

router.get(
  "/signals",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (_req, res) => {
    try {
      const result = await pg.query(`
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
        ORDER BY created_at DESC
        LIMIT 50
      `);

      res.json({
        count: result.rows.length,
        signals: result.rows
      });
    } catch (err) {
      console.error("signals_api_error", err);

      res.status(500).json({
        error: "signals_query_failed"
      });
    }
  }
);

export default router;
