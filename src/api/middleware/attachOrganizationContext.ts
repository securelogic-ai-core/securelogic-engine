import type { Request, Response, NextFunction } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { effectiveEntitlementLevel, graceState } from "../lib/graceWindow.js";

/**
 * Loads org-level context onto req.organizationContext.
 *
 * Source of truth for entitlement is organizations.entitlement_level
 * (single column, written only by Stripe webhook). This middleware is the
 * sole reader of that column in the request path; downstream middleware
 * (requireEntitlement) and routes consume req.organizationContext.
 *
 * GRACE IS DERIVED HERE (SL-BILL-1 PR-F). Being the sole reader is exactly why:
 * one place decides what the request path enforces, so a payment-failure grace
 * window can be applied without a background job having to be correct or even
 * to have run. `payment_failed_at` was already in this SELECT; the grace
 * decision costs one added column and no extra query.
 *
 * The stored level stays the Stripe projection and is never mutated here — the
 * sweep materialises it so exports and dashboards agree with enforcement. What
 * this middleware computes is the level to ENFORCE, which can be lower than the
 * stored one for a window of at most one sweep interval.
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
      stripe_subscription_tier: string | null;
      stripe_subscription_status: string | null;
      viewer_export_enabled: boolean | null;
      voice_input_enabled: boolean | null;
    }>(
      `SELECT entitlement_level, payment_failed_at, stripe_customer_id,
              stripe_subscription_tier, stripe_subscription_status,
              viewer_export_enabled, voice_input_enabled
         FROM organizations
        WHERE id = $1
        LIMIT 1`,
      [organizationId]
    );

    const row = result.rows[0];

    const graceInputs = {
      paymentFailedAt: row?.payment_failed_at ?? null,
      subscriptionStatus: row?.stripe_subscription_status ?? null,
    };
    const storedLevel = row?.entitlement_level ?? null;
    const enforcedLevel = effectiveEntitlementLevel(storedLevel, graceInputs);

    if (enforcedLevel !== storedLevel) {
      // A lapsed grace window that the sweep has not yet materialised. Worth a
      // log line rather than a silent divergence: a steady stream of these
      // means the sweep is not running, and the only reason nobody has noticed
      // is that this derivation is quietly covering for it.
      logger.info(
        {
          event: "grace_window_enforced_below_stored",
          organizationId,
          storedLevel,
          enforcedLevel,
        },
        "attachOrganizationContext: grace lapsed — enforcing below the stored level"
      );
    }

    (req as any).organizationContext = {
      organizationId,
      entitlementLevel: enforcedLevel,
      /** The Stripe projection, before grace. Diagnostics and billing surfaces. */
      storedEntitlementLevel: storedLevel,
      graceState: graceState(graceInputs),
      paymentFailedAt: row?.payment_failed_at ?? null,
      stripeCustomerId: row?.stripe_customer_id ?? null,
      // Precise Stripe tier — entitlement_level collapses Brief Team into
      // 'professional' (rank 2), so tier-scoped capabilities (team invites)
      // need the raw tier to distinguish 'teams' from solo Brief Pro.
      stripeSubscriptionTier: row?.stripe_subscription_tier ?? null,
      // Per-org grant consumed by the seat resolver: may Viewer-class
      // identities bulk-export? Full/admin always may regardless.
      viewerExportEnabled: row?.viewer_export_enabled === true,
      // Tenant voice governance control (ASK-C C-1): defaults ON — a missing
      // row/column must not disable a live capability, so only an explicit
      // false disables (mirrors the column's NOT NULL DEFAULT true).
      voiceInputEnabled: row?.voice_input_enabled !== false,
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
