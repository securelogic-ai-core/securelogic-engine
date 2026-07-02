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
 * Returns the Stripe customer ID for the given organization.
 *
 * If one already exists on the organizations row, returns it immediately
 * (idempotent — prevents duplicate customers when checkout is called more
 * than once).
 *
 * Otherwise creates a new Stripe Customer, persists the ID on the org, and
 * returns it. Storing the ID before checkout completes means the portal
 * endpoint never depends on webhook delivery timing.
 *
 * The created Stripe customer carries both organization_id (durable) and
 * api_key_id (legacy compatibility for in-flight webhook events) in its
 * metadata.
 */
async function resolveStripeCustomer(
  organizationId: string,
  description: string | null,
  apiKeyId: string | null
): Promise<string> {
  const existing = await pg.query(
    `SELECT stripe_customer_id FROM organizations WHERE id = $1 LIMIT 1`,
    [organizationId]
  );

  const existingCustomerId = existing.rows[0]?.stripe_customer_id as string | null;

  if (existingCustomerId) {
    return existingCustomerId;
  }

  const customer = await getStripe().customers.create({
    description: description ?? `org:${organizationId}`,
    metadata: {
      organization_id: organizationId,
      ...(apiKeyId ? { api_key_id: apiKeyId } : {}),
    },
  });

  await pg.query(
    `UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2`,
    [customer.id, organizationId]
  );

  logger.info(
    { event: "stripe_customer_created", organizationId, customerId: customer.id },
    "Stripe customer created and stored on organization"
  );

  return customer.id;
}

/* =========================================================
   TIER → STRIPE PRICE ID MAPPING

   Five tiers (one free, four paid):
     starter          →  (no Stripe — default free plan)
     professional     →  STRIPE_PRICE_ID_PROFESSIONAL      ($49/mo)
     teams            →  STRIPE_PRICE_ID_TEAMS             ($199/mo, up to 6 seats)
     platform         →  STRIPE_PRICE_ID_PLATFORM          ($800/mo)
     platform_annual  →  STRIPE_PRICE_ID_PLATFORM_ANNUAL   ($7,200/yr = $600/mo billed annually)

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

/**
 * Tiers eligible for the free trial. PLATFORM ONLY — both the monthly
 * ($800/mo) and annual ($7,200/yr) Platform prices. The Brief tiers
 * (professional, teams) are NEVER trial-eligible: the Free Intelligence
 * Brief is the Brief funnel, so a Brief-tier trial would cannibalise it.
 */
const PLATFORM_TRIAL_TIERS = new Set(["platform", "platform_annual"]);

/**
 * Master switch for the Platform free trial. OFF unless
 * SECURELOGIC_PLATFORM_TRIAL_ENABLED === "true" (default off, declared with a
 * safe "false" value in render.yaml). With the flag off, Platform checkouts
 * behave exactly as before — no trial, immediate payment.
 */
function platformTrialEnabled(): boolean {
  return process.env.SECURELOGIC_PLATFORM_TRIAL_ENABLED === "true";
}

/** Trial length in days, from TRIAL_PERIOD_DAYS (default 14). */
function trialPeriodDays(): number {
  const raw = parseInt(process.env.TRIAL_PERIOD_DAYS ?? "14", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 14;
}

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

router.post("/billing/checkout", requireApiKey, attachOrganizationContext, async (req, res) => {
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
      `${(process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "")}/success`;
    const cancelUrl =
      process.env.STRIPE_CANCEL_URL?.trim() ??
      `${(process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "")}/dashboard`;

    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const apiKeyId = typeof apiKey.id === "string" ? apiKey.id : null;
    const apiKeyLabel = typeof apiKey.label === "string" ? apiKey.label : null;
    const orgId = (req as any).organizationContext?.organizationId as string | null;

    if (!apiKeyId || !orgId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    // Resolve (or create) a Stripe Customer for the organization. Storing
    // stripe_customer_id on the org row immediately means portal access
    // does not depend on webhook timing.
    const customerId = await resolveStripeCustomer(orgId, apiKeyLabel, apiKeyId);

    // Platform free trial — Platform tiers only, flag-gated, one per org.
    const applyTrial = platformTrialEnabled() && PLATFORM_TRIAL_TIERS.has(tier);

    if (applyTrial) {
      // Re-trial guard: ONE trial per organization, enforced here at
      // checkout-session creation and FAILING CLOSED. trial_started_at is set
      // by the webhook when a trial actually begins (not here), so an abandoned
      // trial checkout never burns the org's single trial. On any DB error the
      // outer catch returns 500 — no session, no trial (fail closed).
      const priorTrial = await pg.query<{ trial_started_at: string | null }>(
        `SELECT trial_started_at FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId]
      );
      if (priorTrial.rows[0]?.trial_started_at) {
        logger.info(
          { event: "billing_trial_already_used", orgId, tier },
          "POST /api/billing/checkout: org already used its Platform trial — rejecting trial checkout"
        );
        res.status(409).json({
          error: "trial_already_used",
          detail: `This organization has already used its ${trialPeriodDays()}-day Platform free trial. You can subscribe without a trial from Manage Billing.`,
        });
        return;
      }
    }

    // Card is required up front — Checkout collects a payment method by default
    // in subscription mode (we never set payment_method_collection:if_required).
    // trial_settings.missing_payment_method:cancel is a safety net so a trial
    // with no card ends by canceling rather than leaving an unpaid invoice.
    const trialFields = applyTrial
      ? {
          trial_period_days: trialPeriodDays(),
          trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } },
        }
      : {};

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // organization_id + tier flow into checkout.session.completed.
      // api_key_id is preserved for backward compatibility with in-flight
      // webhook events from prior subs.
      metadata: { organization_id: orgId, api_key_id: apiKeyId, tier },
      // Same metadata propagated to all subscription lifecycle events.
      subscription_data: {
        metadata: { organization_id: orgId, api_key_id: apiKeyId, tier },
        ...trialFields,
      },
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
      {
        event: "billing_checkout_created",
        apiKeyId,
        customerId,
        sessionId: session.id,
        tier,
        trialDays: applyTrial ? trialPeriodDays() : null,
      },
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

router.post("/billing/portal", requireApiKey, attachOrganizationContext, async (req, res) => {
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
    const ctx = (req as any).organizationContext as
      | { organizationId: string | null; entitlementLevel: string | null; stripeCustomerId: string | null }
      | undefined;
    const orgId = ctx?.organizationId ?? null;

    if (!apiKeyId || !orgId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    let customerId = ctx?.stripeCustomerId ?? null;

    if (!customerId) {
      // Auto-provision a Stripe customer for orgs whose entitlement was
      // granted outside of checkout (manual grant, seed, migration).
      // resolveStripeCustomer re-reads the row and returns any existing ID
      // before creating a new one, so this stays idempotent under retries.
      try {
        customerId = await resolveStripeCustomer(orgId, apiKeyLabel, apiKeyId);
        logger.info(
          { event: "billing_portal_customer_autoprovisioned", orgId, customerId },
          "POST /api/billing/portal: auto-provisioned Stripe customer for org with no prior checkout"
        );
      } catch (err) {
        logger.error(
          { event: "billing_portal_customer_provision_failed", orgId, err },
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

    // Append the pre-portal entitlement so /billing-return can detect changes
    // on the very first poll without burning an attempt establishing baseline.
    const returnUrlWithFrom =
      returnUrl + "?from=" + encodeURIComponent(ctx?.entitlementLevel ?? "free");

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrlWithFrom,
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
    const orgId = (req as any).organizationContext?.organizationId as string | null;

    if (!orgId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    const result = await pg.query<{
      entitlement_level:           string;
      stripe_customer_id:          string | null;
      payment_failed_at:           string | null;
      stripe_subscription_tier:    string | null;
      stripe_subscription_status:  string | null;
    }>(
      `SELECT entitlement_level, stripe_customer_id,
              payment_failed_at, stripe_subscription_tier,
              stripe_subscription_status
         FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    const row = result.rows[0]!;
    const {
      entitlement_level,
      stripe_customer_id,
      payment_failed_at,
      stripe_subscription_tier,
      stripe_subscription_status,
    } = row;

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
      // always returns a useful response rather than a 500. Prefer the cached
      // stripe_subscription_status (written by webhook); if it's NULL on
      // legacy rows, infer from entitlement_level.
      logger.warn(
        { event: "billing_subscription_stripe_fallback", orgId, err },
        "GET /api/billing/subscription: Stripe API call failed, using DB state"
      );

      if (stripe_subscription_status === "active" || stripe_subscription_status === "trialing") {
        status = "active";
      } else if (stripe_subscription_status === "past_due") {
        status = "past_due";
      } else if (stripe_subscription_status === "canceled" || stripe_subscription_status === "unpaid") {
        status = "canceled";
      } else {
        status = (entitlement_level === "professional" || entitlement_level === "premium")
          ? "active"
          : "none";
      }
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
