import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

router.get(
  "/newsletter-deliveries",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
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
          issue_id,
          subscriber_email,
          status,
          delivered_at,
          provider_message_id,
          created_at
        FROM newsletter_deliveries
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
        deliveries: result.rows
      });
    } catch (err) {
      console.error("newsletter_deliveries_query_failed", err);
      res.status(500).json({ error: "newsletter_deliveries_query_failed" });
    }
  }
);

export default router;
