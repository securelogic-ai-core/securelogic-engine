import type { Request, Response, NextFunction } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

/**
 * Loads org-level context onto req.organizationContext.
 *
 * Source of truth for entitlement is organizations.entitlement_level
 * (single column, written only by Stripe webhook). This middleware is the
 * sole reader of that column in the request path; downstream middleware
 * (requireEntitlement) and routes consume req.organizationContext.
 *
 * Must run after requireApiKey, which populates req.apiKey with the
 * organization_id used for the lookup.
 */
export async function attachOrganizationContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = (req as any).apiKey as Record<string, unknown> | undefined;

  const organizationId =
    apiKey && typeof apiKey.organization_id === "string"
      ? apiKey.organization_id
      : null;

  if (!organizationId) {
    (req as any).organizationContext = {
      organizationId: null,
      entitlementLevel: null,
      paymentFailedAt: null,
      stripeCustomerId: null,
    };
    next();
    return;
  }

  try {
    const result = await pg.query<{
      entitlement_level: string;
      payment_failed_at: string | null;
      stripe_customer_id: string | null;
    }>(
      `SELECT entitlement_level, payment_failed_at, stripe_customer_id
         FROM organizations
        WHERE id = $1
        LIMIT 1`,
      [organizationId]
    );

    const row = result.rows[0];

    (req as any).organizationContext = {
      organizationId,
      entitlementLevel: row?.entitlement_level ?? null,
      paymentFailedAt: row?.payment_failed_at ?? null,
      stripeCustomerId: row?.stripe_customer_id ?? null,
    };

    next();
  } catch (err) {
    logger.error(
      { event: "attach_organization_context_failed", organizationId, err },
      "attachOrganizationContext: failed to load organization row"
    );
    res.status(500).json({ error: "organization_context_load_failed" });
  }
}
