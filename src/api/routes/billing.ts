import { Router } from "express";
import { logger } from "../infra/logger.js";
import { getStripe } from "../infra/stripeClient.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
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

   Two paid tiers:
     professional  →  STRIPE_PRICE_ID_PROFESSIONAL  ($49/mo)
     team          →  STRIPE_PRICE_ID_TEAM           ($249/mo)

   The tier is passed in the request body, validated here, and
   stored in Stripe session/subscription metadata so the webhook
   can write the correct entitlement_level on completion.
   ========================================================= */

const VALID_TIERS = new Set(["professional", "team"]);

function resolvePriceId(tier: string): string | null {
  if (tier === "professional") {
    return process.env.STRIPE_PRICE_ID_PROFESSIONAL?.trim() ?? null;
  }
  if (tier === "team") {
    return process.env.STRIPE_PRICE_ID_TEAM?.trim() ?? null;
  }
  return null;
}

/* =========================================================
   CREATE CHECKOUT SESSION
   POST /api/billing/checkout

   Body: { tier: "professional" | "team" }

   Creates a Stripe subscription checkout session for the
   calling API key. A Stripe Customer is created (or reused)
   before the session so the customer ID is durable in our DB
   regardless of webhook delivery timing.
   ========================================================= */

router.post("/billing/checkout", requireApiKey, async (req, res) => {
  try {
    const tierRaw = typeof req.body?.tier === "string" ? req.body.tier.trim().toLowerCase() : null;

    if (!tierRaw || !VALID_TIERS.has(tierRaw)) {
      res.status(400).json({ error: "invalid_tier", valid: ["professional", "team"] });
      return;
    }

    const tier = tierRaw as "professional" | "team";
    const priceId = resolvePriceId(tier);
    const successUrl = process.env.STRIPE_SUCCESS_URL?.trim();
    const cancelUrl = process.env.STRIPE_CANCEL_URL?.trim();

    if (!priceId || !successUrl || !cancelUrl) {
      logger.error(
        { event: "billing_checkout_misconfigured", tier },
        "POST /api/billing/checkout: Stripe env vars not fully configured"
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

    if (!apiKeyId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    const result = await pg.query(
      `SELECT stripe_customer_id FROM api_keys WHERE id = $1 LIMIT 1`,
      [apiKeyId]
    );

    const customerId = result.rows[0]?.stripe_customer_id as string | null;

    if (!customerId) {
      logger.warn(
        { event: "billing_portal_no_customer", apiKeyId },
        "POST /api/billing/portal: no stripe_customer_id — key has not been through checkout"
      );
      res.status(404).json({ error: "no_billing_account" });
      return;
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
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

export default router;
