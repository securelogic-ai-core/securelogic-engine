import { Router } from "express";
import { logger } from "../infra/logger.js";
import { getStripe } from "../infra/stripeClient.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { pg } from "../infra/postgres.js";

const router = Router();

/* =========================================================
   HELPERS
   ========================================================= */

/**
 * Returns the Stripe customer ID for the given api_keys row.
 *
 * If one already exists in our DB, returns it immediately (idempotent —
 * prevents duplicate customers when checkout is called more than once).
 *
 * Otherwise creates a new Stripe Customer, persists the ID, and returns it.
 * Storing the ID before checkout completes means the portal endpoint never
 * depends on webhook delivery timing.
 */
async function resolveStripeCustomer(
  apiKeyId: string,
  apiKeyLabel: string | null
): Promise<string> {
  // Check whether we already have a customer for this key
  const existing = await pg.query(
    `SELECT stripe_customer_id FROM api_keys WHERE id = $1 LIMIT 1`,
    [apiKeyId]
  );

  const existingCustomerId = existing.rows[0]?.stripe_customer_id as string | null;

  if (existingCustomerId) {
    return existingCustomerId;
  }

  // Create a new Stripe Customer and store it immediately
  const customer = await getStripe().customers.create({
    description: apiKeyLabel ?? `api_key:${apiKeyId}`,
    metadata: { api_key_id: apiKeyId }
  });

  await pg.query(
    `UPDATE api_keys SET stripe_customer_id = $1 WHERE id = $2`,
    [customer.id, apiKeyId]
  );

  logger.info(
    { event: "stripe_customer_created", apiKeyId, customerId: customer.id },
    "Stripe customer created and stored"
  );

  return customer.id;
}

/* =========================================================
   TIER → STRIPE PRICE ID MAPPING

   Five tiers (one free, four paid):
     starter          →  (no Stripe — default free plan)
     professional     →  STRIPE_PRICE_ID_PROFESSIONAL      ($29/mo)
     teams            →  STRIPE_PRICE_ID_TEAMS             ($189/mo, up to 10 seats)
     platform         →  STRIPE_PRICE_ID_PLATFORM          ($1,099/mo)
     platform_annual  →  STRIPE_PRICE_ID_PLATFORM_ANNUAL   ($12,000/yr)

   Entitlement mapping:
     professional, teams                 → entitlement_level="professional" (Brief access)
     platform, platform_annual           → entitlement_level="premium"      (full platform)

   The tier is passed in the request body, validated here, and stored in
   Stripe session/subscription metadata so the webhook can write the
   correct entitlement_level on completion. The legacy "team" tier is
   no longer accepted for new checkouts; any pre-existing "team" Stripe
   subscriptions are handled by the webhook's legacy tier whitelist.
   ========================================================= */

const VALID_TIERS = new Set(["professional", "teams", "platform", "platform_annual"]);

function resolvePriceId(tier: string): string {
  const map: Record<string, string | undefined> = {
    professional:    process.env.STRIPE_PRICE_ID_PROFESSIONAL?.trim(),
    teams:           process.env.STRIPE_PRICE_ID_TEAMS?.trim(),
    platform:        process.env.STRIPE_PRICE_ID_PLATFORM?.trim(),
    platform_annual: process.env.STRIPE_PRICE_ID_PLATFORM_ANNUAL?.trim(),
  };
  const priceId = map[tier];
  if (!priceId) throw new Error(`Unknown tier: ${tier}`);
  return priceId;
}

/* =========================================================
   CREATE CHECKOUT SESSION
   POST /api/billing/checkout

   Body: { tier: "professional" | "teams" | "platform" | "platform_annual" }

   Creates a Stripe subscription checkout session for the
   calling API key. A Stripe Customer is created (or reused)
   before the session so the customer ID is durable in our DB
   regardless of webhook delivery timing.
   ========================================================= */

router.post("/billing/checkout", requireApiKey, async (req, res) => {
  try {
    const tierRaw = typeof req.body?.tier === "string" ? req.body.tier.trim().toLowerCase() : null;

    if (!tierRaw || !VALID_TIERS.has(tierRaw)) {
      res.status(400).json({
        error: "invalid_tier",
        valid: ["professional", "teams", "platform", "platform_annual"],
      });
      return;
    }

    const tier = tierRaw as "professional" | "teams" | "platform" | "platform_annual";

    let priceId: string;
    try {
      priceId = resolvePriceId(tier);
    } catch (err) {
      // resolvePriceId throws when the required STRIPE_PRICE_ID_* env var is absent.
      logger.error(
        { event: "billing_checkout_misconfigured", tier, err },
        "POST /api/billing/checkout: Stripe price ID env var not configured"
      );
      res.status(503).json({ error: "billing_not_configured" });
      return;
    }

    const successUrl =
      process.env.STRIPE_SUCCESS_URL?.trim() ??
      "https://app.securelogicai.com/dashboard?upgraded=true";
    const cancelUrl =
      process.env.STRIPE_CANCEL_URL?.trim() ??
      "https://app.securelogicai.com/dashboard";

    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const apiKeyId = typeof apiKey.id === "string" ? apiKey.id : null;
    const apiKeyLabel = typeof apiKey.label === "string" ? apiKey.label : null;

    if (!apiKeyId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    // Resolve (or create) a Stripe Customer before creating the session.
    // This stores stripe_customer_id in our DB immediately — portal access
    // does not depend on webhook timing.
    const customerId = await resolveStripeCustomer(apiKeyId, apiKeyLabel);

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // tier + api_key_id flow into checkout.session.completed
      metadata: { api_key_id: apiKeyId, tier },
      // tier + api_key_id flow into all subscription lifecycle events
      subscription_data: { metadata: { api_key_id: apiKeyId, tier } },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    if (!session.url) {
      logger.error(
        { event: "billing_checkout_no_url" },
        "POST /api/billing/checkout: Stripe returned no checkout URL"
      );
      res.status(500).json({ error: "checkout_url_missing" });
      return;
    }

    logger.info(
      { event: "billing_checkout_created", apiKeyId, customerId, sessionId: session.id, tier },
      "Stripe checkout session created"
    );

    res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error(
      { event: "billing_checkout_failed", err },
      "POST /api/billing/checkout failed"
    );
    res.status(500).json({ error: "billing_checkout_failed" });
  }
});

/* =========================================================
   CREATE BILLING PORTAL SESSION
   POST /api/billing/portal

   Returns a Stripe Customer Portal URL for the calling API key.
   The portal lets subscribers manage their plan, update payment
   methods, and cancel. Requires a stripe_customer_id stored on
   the key — set at checkout creation time, not at webhook time.
   ========================================================= */

router.post("/billing/portal", requireApiKey, async (req, res) => {
  try {
    const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL?.trim();

    if (!returnUrl) {
      logger.error(
        { event: "billing_portal_misconfigured" },
        "POST /api/billing/portal: STRIPE_PORTAL_RETURN_URL not set"
      );
      res.status(503).json({ error: "billing_not_configured" });
      return;
    }

    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const apiKeyId = typeof apiKey.id === "string" ? apiKey.id : null;
    const apiKeyLabel = typeof apiKey.label === "string" ? apiKey.label : null;

    if (!apiKeyId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    const result = await pg.query(
      `SELECT stripe_customer_id FROM api_keys WHERE id = $1 LIMIT 1`,
      [apiKeyId]
    );

    let customerId = result.rows[0]?.stripe_customer_id as string | null;

    if (!customerId) {
      // Auto-provision a Stripe customer for admins whose entitlement was
      // granted outside of checkout (manual grant, seed, migration).
      // resolveStripeCustomer re-reads the row and returns any existing ID
      // before creating a new one, so this stays idempotent under retries.
      try {
        customerId = await resolveStripeCustomer(apiKeyId, apiKeyLabel);
        logger.info(
          { event: "billing_portal_customer_autoprovisioned", apiKeyId, customerId },
          "POST /api/billing/portal: auto-provisioned Stripe customer for admin with no prior checkout"
        );
      } catch (err) {
        logger.error(
          { event: "billing_portal_customer_provision_failed", apiKeyId, err },
          "POST /api/billing/portal: failed to auto-provision Stripe customer"
        );
        res.status(503).json({ error: "billing_not_configured" });
        return;
      }
    }

    // STRIPE_PORTAL_CONFIGURATION_ID — set this env var to a portal configuration ID
    // created in the Stripe Dashboard under Settings → Billing → Customer Portal.
    //
    // MANUAL STRIPE CONFIGURATION REQUIRED:
    // The portal configuration must be created in the Stripe Dashboard, not via code.
    // Enable the following features on that configuration:
    //   - subscription_update: enabled, default_allowed_updates: ['price'],
    //     proration_behavior: 'create_prorations'
    //     (also add all plan prices to the "Allowed plan updates" list in the Dashboard)
    //   - subscription_cancel: enabled, mode: 'at_period_end',
    //     cancellation_reason: enabled with options: too_expensive, missing_features,
    //     switched_service, unused, other
    //   - payment_method_update: enabled
    //   - invoice_history: enabled
    //
    // Without this configuration, the portal shows payment management only — plan
    // upgrades, downgrades, and cancellations require the portal configuration to be set.
    const portalConfigId = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || undefined;

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      ...(portalConfigId ? { configuration: portalConfigId } : {}),
    });

    logger.info(
      { event: "billing_portal_created", apiKeyId, customerId },
      "Stripe billing portal session created"
    );

    res.status(200).json({ portalUrl: portalSession.url });
  } catch (err) {
    logger.error(
      { event: "billing_portal_failed", err },
      "POST /api/billing/portal failed"
    );
    res.status(500).json({ error: "billing_portal_failed" });
  }
});

/* =========================================================
   GET SUBSCRIPTION STATUS
   GET /api/billing/subscription

   Returns the current billing state for the calling API key:
   live subscription status from Stripe (if available) with a
   DB fallback, plus the raw subscription tier and any pending
   payment failure timestamp.
   ========================================================= */

router.get("/billing/subscription", requireApiKey, attachOrganizationContext, async (req, res) => {
  try {
    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const apiKeyId = typeof apiKey.id === "string" ? apiKey.id : null;

    if (!apiKeyId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    const result = await pg.query<{
      entitlement_level:        string;
      stripe_customer_id:       string | null;
      payment_failed_at:        string | null;
      stripe_subscription_tier: string | null;
    }>(
      `SELECT entitlement_level, stripe_customer_id,
              payment_failed_at, stripe_subscription_tier
       FROM api_keys WHERE id = $1 LIMIT 1`,
      [apiKeyId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "api_key_not_found" });
      return;
    }

    const row = result.rows[0]!;
    const { entitlement_level, stripe_customer_id, payment_failed_at, stripe_subscription_tier } = row;

    // Derive a human-readable tier label from entitlement_level
    const tier =
      entitlement_level === "professional" ? "professional" :
      entitlement_level === "premium"      ? "premium"      : "free";

    // No billing account — key has never gone through checkout
    if (!stripe_customer_id) {
      res.status(200).json({
        tier,
        entitlement_level,
        status:             "none",
        stripe_customer_id: null,
        current_period_end: null,
        payment_failed_at:  payment_failed_at ?? null,
        subscription_tier:  stripe_subscription_tier ?? null
      });
      return;
    }

    // Fetch live subscription state from Stripe
    type BillingStatus = "active" | "past_due" | "canceled" | "none";
    let status: BillingStatus = "none";
    let current_period_end: string | null = null;

    try {
      const subs = await getStripe().subscriptions.list({
        customer: stripe_customer_id,
        limit: 1,
        status: "all"
      });

      const sub = subs.data[0] ?? null;

      if (sub) {
        if (sub.status === "active" || sub.status === "trialing") {
          status = "active";
        } else if (sub.status === "past_due") {
          status = "past_due";
        } else if (sub.status === "canceled" || sub.status === "unpaid") {
          status = "canceled";
        }

        // current_period_end moved from Subscription to SubscriptionItem in Stripe v22
        const periodEnd = sub.items.data[0]?.current_period_end ?? null;
        current_period_end = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null;
      }
    } catch (err) {
      // Stripe unavailable — fall back to DB-derived status so the endpoint
      // always returns a useful response rather than a 500.
      logger.warn(
        { event: "billing_subscription_stripe_fallback", apiKeyId, err },
        "GET /api/billing/subscription: Stripe API call failed, using DB state"
      );

      status = (entitlement_level === "professional" || entitlement_level === "premium")
        ? "active"
        : "none";
    }

    res.status(200).json({
      tier,
      entitlement_level,
      status,
      stripe_customer_id,
      current_period_end,
      payment_failed_at:  payment_failed_at ?? null,
      subscription_tier:  stripe_subscription_tier ?? null
    });
  } catch (err) {
    logger.error(
      { event: "billing_subscription_failed", err },
      "GET /api/billing/subscription failed"
    );
    res.status(500).json({ error: "billing_subscription_failed" });
  }
});

export default router;
