import type { Request, Response } from "express";
import type Stripe from "stripe";

import { getStripe } from "../infra/stripeClient.js";
import { logger } from "../infra/logger.js";
import { pg } from "../infra/postgres.js";
import {
  setEntitlementInRedis,
  type EntitlementRecord
} from "../infra/entitlementStore.js";
import { claimWebhookEvent } from "./webhookIdempotency.js";
import { applyBriefToPlatformCredit } from "../lib/briefPlatformCredit.js";

/* =========================================================
   CONSTANTS
   ========================================================= */

const MAX_SIG_LENGTH = 512;

/**
 * Events that grant premium access.
 */
const GRANT_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated"
]);

/**
 * Events that revoke access.
 */
const REVOKE_EVENTS = new Set([
  "customer.subscription.deleted"
]);

/**
 * Events that flag a payment failure.
 * Access is NOT revoked — payment_failed_at is stamped on the api_key row
 * for observability and dunning UX. Stripe will handle eventual cancellation
 * via customer.subscription.updated (past_due → canceled) after its retry cycle.
 *
 * Register in Stripe Dashboard: invoice.payment_failed
 */
const PAYMENT_FAILED_EVENTS = new Set([
  "invoice.payment_failed"
]);

/* =========================================================
   HELPERS
   ========================================================= */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidApiKeyId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return UUID_RE.test(value.trim());
}

/**
 * Raw tier strings that are known to the billing system. Values fall into
 * three buckets:
 *   - Current checkout tiers:  professional, teams, platform, platform_annual
 *   - Legacy (pre-overhaul):   team, paid, admin
 *
 * Anything outside this set is logged as stripe_unknown_tier. The function
 * still returns a sensible default ("paid") so webhook delivery is never
 * blocked by a bad metadata value, but the warning ensures silent drift
 * between the product catalog and this whitelist is loud in logs.
 */
const KNOWN_TIERS = new Set([
  "professional", "teams", "platform", "platform_annual",
  "team", "paid", "admin"
]);

/**
 * Map of Stripe price IDs → raw tier labels, built at module load from
 * STRIPE_PRICE_ID_PROFESSIONAL / _TEAMS / _PLATFORM / _PLATFORM_ANNUAL.
 *
 * Used by resolveTier and extractRawSubscriptionTier so subscription events
 * derive the tier directly from the current price, which is the only
 * reliable source for portal-driven upgrades and downgrades — Stripe leaves
 * a subscription's metadata untouched when a customer changes plans through
 * the Stripe Customer Portal. Entries are only added for env vars that are
 * set, so missing config gracefully degrades to metadata-based resolution.
 */
const PRICE_ID_TO_TIER: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const envPairs: Array<[string, string]> = [
    ["STRIPE_PRICE_ID_PROFESSIONAL",    "professional"],
    ["STRIPE_PRICE_ID_TEAMS",           "teams"],
    ["STRIPE_PRICE_ID_PLATFORM",        "platform"],
    ["STRIPE_PRICE_ID_PLATFORM_ANNUAL", "platform_annual"]
  ];
  for (const [envVar, tier] of envPairs) {
    const id = process.env[envVar]?.trim();
    if (id) map[id] = tier;
  }
  return map;
})();

/**
 * Returns the raw tier label for a subscription's first price item, or null
 * if the price ID is not in the env-configured map. SecureLogic plans are
 * single-item, so the first item is authoritative for the current catalog.
 */
function resolveTierFromPriceId(subscription: Stripe.Subscription): string | null {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (!priceId) return null;
  return PRICE_ID_TO_TIER[priceId] ?? null;
}

/**
 * Resolves the SecureLogic entitlement tier for a Stripe event.
 *
 * Returns a value from the Redis Tier union ("professional" | "paid"):
 *   - "professional" → Brief tier (entitlement_level="professional")
 *       raw: "professional", "teams"
 *   - "paid"         → full platform tier (entitlement_level="premium")
 *       raw: "platform", "platform_annual", legacy "team"/"paid"/"admin"
 *
 * For customer.subscription.* events, the subscription's current price ID
 * is the source of truth — portal-driven upgrades/downgrades change the
 * price without rewriting metadata, so metadata can be stale. If price-ID
 * resolution fails (env var missing, unknown price), falls back to metadata.
 * Non-subscription events (checkout.session.completed, etc.) read metadata
 * directly, preserving prior behavior.
 *
 * Unknown raw values are logged as stripe_unknown_tier and default to "paid"
 * for forward compatibility with legacy events that predate tier metadata.
 */
function resolveTier(event: Stripe.Event): "professional" | "paid" {
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    const priceTier = resolveTierFromPriceId(subscription);
    if (priceTier === "professional" || priceTier === "teams") {
      return "professional";
    }
    if (priceTier === "platform" || priceTier === "platform_annual") {
      return "paid";
    }
    // priceTier === null → fall through to metadata
  }

  const obj = event.data.object as any;
  const rawTier =
    obj?.metadata?.tier ??
    obj?.subscription_details?.metadata?.tier ??
    null;

  if (!rawTier || !KNOWN_TIERS.has(rawTier)) {
    logger.warn(
      { event: "stripe_unknown_tier", rawTier, stripeEventType: event.type },
      "stripeWebhook: unknown or missing tier in metadata — defaulting to 'paid'"
    );
    return "paid";
  }

  if (rawTier === "professional" || rawTier === "teams") {
    return "professional";
  }

  // platform, platform_annual, team (legacy), paid (legacy), admin (legacy)
  return "paid";
}

/**
 * Determines whether a subscription event should grant or revoke entitlement.
 * For `customer.subscription.updated`, the subscription status is the deciding factor.
 */
function classifySubscriptionEvent(
  eventType: string,
  subscription: Stripe.Subscription | null,
  metadataTier: "professional" | "paid"
): EntitlementRecord | null {
  if (REVOKE_EVENTS.has(eventType)) {
    return { tier: "free", activeSubscription: false };
  }

  if (eventType === "customer.subscription.updated" && subscription) {
    const status = subscription.status;
    if (status === "active" || status === "trialing") {
      return { tier: metadataTier, activeSubscription: true };
    }
    if (
      status === "canceled" ||
      status === "past_due" ||
      status === "unpaid" ||
      status === "incomplete_expired"
    ) {
      return { tier: "free", activeSubscription: false };
    }
    // incomplete / paused — ignore
    return null;
  }

  if (GRANT_EVENTS.has(eventType)) {
    return { tier: metadataTier, activeSubscription: true };
  }

  return null;
}

/**
 * Extract the SecureLogic api_keys.id (UUID) from Stripe event metadata.
 * The id is stored in session.metadata.api_key_id or subscription.metadata.api_key_id.
 */
function extractApiKeyId(event: Stripe.Event): string | null {
  const obj = event.data.object as any;

  return (
    obj?.metadata?.api_key_id ??
    obj?.subscription_details?.metadata?.api_key_id ??
    null
  );
}

/**
 * Extract the Stripe customer ID from a Stripe event object.
 * Present on subscriptions and checkout sessions.
 */
function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as any;
  const id = obj?.customer;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Extracts the raw subscription tier string for storage in
 * api_keys.stripe_subscription_tier. Returns 'professional', 'teams',
 * 'platform', 'platform_annual', or legacy 'team' when known; null otherwise.
 *
 * For customer.subscription.* events, the subscription's price ID is the
 * source of truth (portal-driven plan changes don't rewrite metadata).
 * Falls back to checkout/subscription metadata for non-subscription events
 * or when no env-configured price matches.
 *
 * This is distinct from resolveTier(): that function normalises 'team' →
 * 'paid' for Redis/entitlement purposes. This function preserves the
 * original value so it can be stored for future feature gating.
 */
function extractRawSubscriptionTier(event: Stripe.Event): string | null {
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    const priceTier = resolveTierFromPriceId(subscription);
    if (priceTier) return priceTier;
  }

  const obj = event.data.object as any;
  const raw =
    obj?.metadata?.tier ??
    obj?.subscription_details?.metadata?.tier ??
    null;
  if (
    raw === "professional" ||
    raw === "teams" ||
    raw === "platform" ||
    raw === "platform_annual" ||
    raw === "team"
  ) {
    return raw;
  }
  return null;
}

/**
 * Maps a tier string to the Postgres entitlement_level value.
 *
 * Accepts both Redis EntitlementRecord tiers ("free"|"professional"|"paid"|"admin")
 * and raw Stripe metadata tiers ("teams"|"platform"|"platform_annual"), so the
 * function is safe against either source of truth.
 *
 *   professional, teams                  → "professional"  (Brief access)
 *   platform, platform_annual, paid, admin → "premium"      (full platform)
 *   free (or anything else)              → "starter"
 */
function tierToDbLevel(tier: string): string {
  if (tier === "professional" || tier === "teams") {
    return "professional";
  }
  if (
    tier === "platform" ||
    tier === "platform_annual" ||
    tier === "paid" ||
    tier === "admin"
  ) {
    return "premium";
  }
  return "starter";
}

/**
 * Resolve the SecureLogic organization_id for a Stripe event.
 *
 * Two paths, tried in order:
 *  1. Customer-id lookup against organizations.stripe_customer_id — the
 *     durable path. Survives api_key rotation: every webhook event for a
 *     given customer always lands on the same org row.
 *  2. api_key_id lookup, used only when path 1 misses. This is the
 *     first-checkout case: the customer was just created, the metadata
 *     carries the api_key_id from billing.ts, but organizations.stripe_customer_id
 *     hasn't been backfilled yet (the webhook write itself is the backfill).
 *
 * Returns null when both paths miss; the caller logs and ignores the event.
 */
async function resolveOrgIdForEvent(
  customerId: string | null,
  apiKeyId: string | null
): Promise<{ orgId: string | null; resolvedBy: "stripe_customer_id" | "api_key_id" | "none" }> {
  if (customerId) {
    const result = await pg.query<{ id: string }>(
      `SELECT id FROM organizations WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId]
    );
    if (result.rows[0]?.id) {
      return { orgId: result.rows[0].id, resolvedBy: "stripe_customer_id" };
    }
  }

  if (apiKeyId) {
    const result = await pg.query<{ organization_id: string }>(
      `SELECT organization_id FROM api_keys WHERE id = $1 LIMIT 1`,
      [apiKeyId]
    );
    if (result.rows[0]?.organization_id) {
      return { orgId: result.rows[0].organization_id, resolvedBy: "api_key_id" };
    }
  }

  return { orgId: null, resolvedBy: "none" };
}

/**
 * Sync entitlement state to the organizations row. Errors are logged but
 * never thrown — the webhook must always return 200 to Stripe.
 *
 * organizations.entitlement_level is the source of truth for entitlement.
 * organizations.plan is kept in lock-step (same value) to support legacy
 * reads (e.g. /api/me); both columns should be retired into one in a
 * follow-up cleanup PR.
 *
 * Subscription identifiers (stripe_subscription_id, stripe_subscription_tier)
 * are stored to support the stale-revoke guard in the main handler: a
 * customer.subscription.deleted event whose sub.id no longer matches the
 * org's current sub.id is a superseded subscription and must not downgrade.
 */
async function syncOrgEntitlement(
  orgId: string,
  entitlement: EntitlementRecord,
  customerId: string | null,
  subscriptionId: string | null,
  rawSubscriptionTier: string | null,
  subscriptionStatus: string | null,
  apiKeyId: string | null
): Promise<void> {
  const level = tierToDbLevel(entitlement.tier);

  // On a successful grant, clear any stale payment_failed_at stamp.
  const clearPaymentFailed = entitlement.activeSubscription;

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    const updateResult = await client.query(
      `
      UPDATE organizations
         SET entitlement_level          = $1,
             plan                       = $1,
             -- Monitored-entity cap. The webhook only ever RAISES a paid org to
             -- at least the 50 default (GREATEST sees the OLD column value) and
             -- NEVER lowers it. This preserves an admin-elevated ("Platform
             -- Scale") cap across renewals AND across a past_due dip: status
             -- past_due/canceled transiently writes entitlement_level='starter'
             -- (the ELSE branch leaves the cap untouched), and the recovery back
             -- to premium keeps the elevated cap instead of resetting it. A
             -- genuine Scale→base downgrade is an operator action (the same
             -- admin path that raised the cap), not a webhook side effect. The
             -- cap is moot while downgraded — those orgs are premium-gated out
             -- of entity creation.
             max_monitored_entities     = CASE
                                            WHEN $1 IN ('premium','professional') THEN GREATEST(max_monitored_entities, 50)
                                            ELSE max_monitored_entities
                                          END,
             stripe_customer_id         = COALESCE(stripe_customer_id, $3),
             stripe_subscription_id     = COALESCE($4, stripe_subscription_id),
             stripe_subscription_tier   = COALESCE($5, stripe_subscription_tier),
             stripe_subscription_status = COALESCE($6, stripe_subscription_status),
             payment_failed_at          = CASE WHEN $7 THEN NULL ELSE payment_failed_at END
       WHERE id = $2
      `,
      [
        level,
        orgId,
        customerId,
        subscriptionId,
        rawSubscriptionTier,
        subscriptionStatus,
        clearPaymentFailed,
      ]
    );

    await client.query("COMMIT");

    const rows = updateResult.rowCount ?? 0;

    if (rows === 0) {
      logger.warn(
        { event: "stripe_webhook_db_sync_no_match", orgId, apiKeyId, level },
        "stripeWebhook: organizations row not found — entitlement not updated"
      );
    } else {
      logger.info(
        { event: "stripe_webhook_db_sync_ok", orgId, apiKeyId, level, customerId },
        "stripeWebhook: organizations.entitlement_level updated"
      );
    }

    // Paid-tier upgrade: auto-subscribe the org's primary (oldest) user to the
    // Intelligence Brief if the org has no active subscriber yet. Best-effort —
    // failures are logged but never bubble up to the webhook handler.
    if (rows > 0 && (level === "professional" || level === "premium")) {
      try {
        const subscribeResult = await pg.query(
          `
          INSERT INTO intelligence_brief_subscribers (organization_id, email, name, active)
          SELECT u.organization_id,
                 LOWER(TRIM(u.email)),
                 NULLIF(u.name, ''),
                 TRUE
          FROM users u
          WHERE u.organization_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM intelligence_brief_subscribers ibs
              WHERE ibs.organization_id = u.organization_id
                AND ibs.active = TRUE
            )
          ORDER BY u.created_at ASC
          LIMIT 1
          ON CONFLICT (organization_id, email) DO UPDATE
            SET active          = TRUE,
                unsubscribed_at = NULL,
                updated_at      = NOW()
          RETURNING id
          `,
          [orgId]
        );

        if ((subscribeResult.rowCount ?? 0) > 0) {
          logger.info(
            { event: "stripe_webhook_brief_auto_subscribed", orgId, level },
            "stripeWebhook: auto-subscribed org primary user to Intelligence Brief"
          );
        }
      } catch (subscribeErr) {
        logger.error(
          { event: "stripe_webhook_brief_auto_subscribe_failed", orgId, err: subscribeErr },
          "stripeWebhook: failed to auto-subscribe org to Intelligence Brief (non-fatal)"
        );
      }
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error(
        { event: "stripe_webhook_db_rollback_failed", rollbackErr },
        "stripeWebhook: ROLLBACK failed after sync error (non-fatal)"
      );
    }
    logger.error(
      { event: "stripe_webhook_db_sync_failed", err },
      "stripeWebhook: failed to sync entitlement to DB (non-fatal)"
    );
  } finally {
    client.release();
  }
}

/**
 * When a customer upgrades to a Platform plan (platform or platform_annual),
 * cancel any other active subscriptions on the same Stripe customer. This
 * prevents a subscriber who previously paid for a Brief plan from being
 * double-charged once they move onto a full-platform subscription.
 *
 * The newly-created platform subscription (identified by newSubscriptionId)
 * is excluded from cancellation so we never cancel the very subscription
 * that just granted access.
 *
 * Non-fatal: any failure is logged and swallowed so webhook delivery is
 * never blocked by a housekeeping cancel step.
 */
async function cancelPriorBriefSubscriptions(
  customerId: string,
  newSubscriptionId: string | null
): Promise<void> {
  try {
    const subs = await getStripe().subscriptions.list({
      customer: customerId,
      status: "active"
    });

    for (const sub of subs.data) {
      if (sub.id === newSubscriptionId) continue;

      try {
        await getStripe().subscriptions.cancel(sub.id, { prorate: true });
        logger.info(
          {
            event: "stripe_brief_sub_cancelled_on_platform_upgrade",
            cancelledSubId: sub.id,
            newSubId: newSubscriptionId,
            customerId
          },
          "stripeWebhook: cancelled prior Brief subscription on platform upgrade"
        );
      } catch (err) {
        logger.error(
          {
            event: "stripe_brief_sub_cancel_failed",
            cancelledSubId: sub.id,
            customerId,
            err
          },
          "stripeWebhook: failed to cancel prior Brief subscription (non-fatal)"
        );
      }
    }
  } catch (err) {
    logger.error(
      { event: "stripe_brief_sub_cancel_failed", customerId, err },
      "stripeWebhook: failed to list prior subscriptions for platform upgrade (non-fatal)"
    );
  }
}

/**
 * Handles invoice.payment_failed: stamps payment_failed_at on the
 * organizations row so the billing UI can surface a dunning state. Does
 * NOT revoke access — Stripe will send customer.subscription.updated
 * (past_due) and eventually customer.subscription.deleted after its retry
 * cycle, which will revoke.
 */
async function handlePaymentFailed(event: Stripe.Event): Promise<void> {
  const obj = event.data.object as any;
  const customerId = typeof obj?.customer === "string" ? obj.customer : null;

  if (!customerId) {
    logger.warn(
      { event: "stripe_invoice_payment_failed_no_customer" },
      "invoice.payment_failed: no customer ID in event — skipping"
    );
    return;
  }

  try {
    const result = await pg.query(
      `
      UPDATE organizations
      SET payment_failed_at = NOW()
      WHERE stripe_customer_id = $1
      `,
      [customerId]
    );

    logger.warn(
      {
        event: "stripe_payment_failed",
        customerId,
        rowsUpdated: result.rowCount ?? 0,
        invoiceId: obj?.id ?? null,
        amountDue: obj?.amount_due ?? null
      },
      "invoice.payment_failed: payment_failed_at stamped — access NOT revoked"
    );
  } catch (err) {
    logger.error(
      { event: "stripe_payment_failed_db_error", customerId, err },
      "invoice.payment_failed: failed to stamp payment_failed_at (non-fatal)"
    );
  }
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

export async function stripeWebhook(
  req: Request,
  res: Response
): Promise<void> {
  // Always return 200 — Stripe retries on non-200 and can DDoS the server.
  const respond = (body: object) => res.status(200).json(body);

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

    if (!webhookSecret) {
      logger.error(
        { event: "stripe_webhook_misconfigured" },
        "stripeWebhook: STRIPE_WEBHOOK_SECRET not set"
      );
      respond({ received: true, updated: false });
      return;
    }

    const sig = req.get("stripe-signature");

    if (!sig || sig.length > MAX_SIG_LENGTH) {
      logger.warn(
        { event: "stripe_webhook_missing_signature" },
        "stripeWebhook: missing or oversized stripe-signature header"
      );
      respond({ received: true, ignored: true });
      return;
    }

    const raw = (req as any).rawBody as unknown;

    if (!Buffer.isBuffer(raw)) {
      logger.error(
        { event: "stripe_webhook_no_raw_body" },
        "stripeWebhook: rawBody missing or not Buffer"
      );
      respond({ received: true, ignored: true });
      return;
    }

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(raw, sig, webhookSecret);
    } catch (err) {
      logger.warn(
        { event: "stripe_webhook_signature_invalid", err },
        "stripeWebhook: signature verification failed"
      );
      respond({ received: true, ignored: true });
      return;
    }

    const eventType = event.type;

    logger.info(
      { event: "stripe_webhook_received", stripeEventType: eventType },
      "stripe webhook received"
    );

    // Idempotency gate (C3). Placed immediately after constructEvent so that
    // payment_failed writes, entitlement writes, and outbound Stripe cancel
    // calls in cancelPriorBriefSubscriptions all sit behind it. Fail-closed
    // on claim INSERT failure: return 500 so Stripe retries — silently
    // re-processing during a Postgres-unhealthy window is worse than letting
    // the provider's retry mechanism handle it.
    try {
      const { firstSeen } = await claimWebhookEvent("stripe", event.id, eventType);
      if (!firstSeen) {
        logger.info(
          {
            event: "stripe_webhook_idempotent_replay",
            stripeEventType: eventType,
            stripeEventId: event.id
          },
          "stripeWebhook: duplicate event_id — short-circuiting before downstream writes"
        );
        respond({ received: true, idempotent_replay: true });
        return;
      }
    } catch (err) {
      logger.error(
        {
          event: "stripe_webhook_idempotency_claim_failed",
          stripeEventType: eventType,
          stripeEventId: event.id,
          err
        },
        "stripeWebhook: idempotency claim INSERT failed — failing closed, Stripe will retry"
      );
      res.status(500).json({ error: "idempotency_check_failed" });
      return;
    }

    // Handle payment failure first — separate action from grant/revoke flow
    if (PAYMENT_FAILED_EVENTS.has(eventType)) {
      await handlePaymentFailed(event);
      respond({ received: true, updated: true });
      return;
    }

    // Trial ending soon (fires ~3 days before a trial converts). No
    // entitlement change — access continues through conversion. Handle
    // explicitly (rather than falling into the generic ignored path) so it
    // is logged as a heads-up and never errors. A dunning/heads-up email can
    // hang off this event later; for now it is a graceful, logged 200.
    if (eventType === "customer.subscription.trial_will_end") {
      const sub = event.data.object as Stripe.Subscription;
      logger.info(
        {
          event: "stripe_trial_will_end",
          subscriptionId: sub.id,
          trialEnd: sub.trial_end,
          customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
        },
        "stripeWebhook: Platform trial ending soon — heads-up only, no entitlement change"
      );
      respond({ received: true, trial_will_end: true });
      return;
    }

    // Determine what entitlement action to take
    const subscription =
      eventType.startsWith("customer.subscription.")
        ? (event.data.object as Stripe.Subscription)
        : null;

    const metadataTier = resolveTier(event);
    const entitlement = classifySubscriptionEvent(eventType, subscription, metadataTier);

    if (!entitlement) {
      respond({ received: true, ignored: true });
      return;
    }

    // Extract the SecureLogic api_keys.id from metadata
    const apiKeyId = extractApiKeyId(event);

    if (!isValidApiKeyId(apiKeyId)) {
      logger.warn(
        {
          event: "stripe_webhook_invalid_api_key_id",
          stripeEventType: eventType
        },
        "stripeWebhook: missing or invalid api_key_id in metadata"
      );
      respond({ received: true, ignored: true });
      return;
    }

    // Extract customer ID, sub ID, raw tier, and status for DB sync
    const customerId = extractCustomerId(event);
    const rawSubscriptionTier = extractRawSubscriptionTier(event);
    const subscriptionId = subscription?.id ?? null;
    const subscriptionStatus = subscription?.status ?? null;

    // Resolve org. Primary path: organizations.stripe_customer_id. Fallback:
    // api_keys.id → organization_id (used for first-checkout events where
    // the customer hasn't been backfilled onto the org yet).
    const { orgId, resolvedBy } = await resolveOrgIdForEvent(customerId, apiKeyId);

    if (!orgId) {
      logger.warn(
        {
          event: "stripe_webhook_org_not_resolved",
          stripeEventType: eventType,
          customerId,
          apiKeyId
        },
        "stripeWebhook: could not resolve organization_id from event — ignoring"
      );
      respond({ received: true, ignored: true, reason: "org_not_resolved" });
      return;
    }

    logger.info(
      { event: "stripe_webhook_org_resolved", orgId, resolvedBy, apiKeyId, customerId },
      "stripeWebhook: resolved organization for event"
    );

    // Stale-revoke guard. Only applies to customer.subscription.deleted: when
    // upgrading tiers, Stripe cancels the old subscription after creating the
    // new one, and the resulting delete event would otherwise downgrade
    // entitlement back to 'starter'. If the deleted sub.id no longer matches
    // the org's current stripe_subscription_id, the cancellation is for a
    // superseded subscription and must be ignored.
    //
    // The guard only fires on .deleted events. customer.subscription.updated
    // events that legitimately change sub state (past_due, canceled status
    // on the live sub) flow through normally.
    if (eventType === "customer.subscription.deleted" && subscriptionId) {
      const { rows } = await pg.query<{ stripe_subscription_id: string | null }>(
        `SELECT stripe_subscription_id FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId]
      );
      const currentSubId = rows[0]?.stripe_subscription_id ?? null;

      if (currentSubId && currentSubId !== subscriptionId) {
        logger.info(
          {
            event: "stripe_webhook_revoke_skipped_stale",
            stripeEventType: eventType,
            orgId,
            currentSubId,
            canceledSubId: subscriptionId
          },
          "stripeWebhook: skipping revoke — canceled sub.id differs from current (superseded subscription)"
        );
        respond({ received: true, ignored: true, reason: "superseded" });
        return;
      }
    }

    // Write to Redis (supplementary cache) then sync to Postgres (primary)
    await setEntitlementInRedis(apiKeyId, entitlement);
    await syncOrgEntitlement(
      orgId,
      entitlement,
      customerId,
      subscriptionId,
      rawSubscriptionTier,
      subscriptionStatus,
      apiKeyId
    );

    // Record the org's one-time Platform trial the moment it actually begins.
    // Set at trial START (not at checkout creation) so an abandoned checkout
    // never burns the org's single trial. Guarded WHERE trial_started_at IS
    // NULL → idempotent across the trialing 'created' + 'updated' events. The
    // checkout handler reads this column to reject a second trial (one per org).
    if (
      subscriptionStatus === "trialing" &&
      (rawSubscriptionTier === "platform" || rawSubscriptionTier === "platform_annual")
    ) {
      const claimed = await pg.query(
        `UPDATE organizations SET trial_started_at = NOW()
          WHERE id = $1 AND trial_started_at IS NULL
          RETURNING id`,
        [orgId]
      );
      if ((claimed.rowCount ?? 0) > 0) {
        logger.info(
          { event: "stripe_platform_trial_started", orgId, subscriptionId },
          "stripeWebhook: Platform trial started — recorded one-time trial claim on organization"
        );
      }
    }

    // Platform upgrade: cancel any prior Brief subscriptions on the same
    // customer so they don't pay twice. Only fires for checkout.session.completed
    // (so we have session.subscription to exclude) with raw tier
    // "platform" or "platform_annual", and only after a successful grant.
    if (
      eventType === "checkout.session.completed" &&
      entitlement.activeSubscription &&
      customerId &&
      (rawSubscriptionTier === "platform" || rawSubscriptionTier === "platform_annual")
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const newSubscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id ?? null;

      // Brief → Platform upgrade credit (#9). Compute the prior Brief sub IDs
      // (active subs other than the new Platform one) and credit BEFORE the
      // cancel, while those subs are still active and their paid invoices are
      // listable. Gated/idempotent/non-fatal — a no-op unless
      // SECURELOGIC_BRIEF_PLATFORM_CREDIT_ENABLED=true.
      try {
        const active = await getStripe().subscriptions.list({ customer: customerId, status: "active" });
        const priorBriefSubscriptionIds = active.data
          .map((s) => s.id)
          .filter((id) => id !== newSubscriptionId);
        await applyBriefToPlatformCredit({
          customerId,
          newSubscriptionId,
          priorBriefSubscriptionIds,
          organizationId: orgId,
        });
      } catch (err) {
        logger.error(
          { event: "brief_platform_credit_wiring_failed", orgId, customerId, err },
          "stripeWebhook: brief→platform credit step failed (non-fatal)"
        );
      }

      await cancelPriorBriefSubscriptions(customerId, newSubscriptionId);
    }

    // NOTE: Stripe no longer auto-enrolls payers into the `subscribers` list.
    // That list fed the legacy Newsletter / Daily Digest sends, which are now
    // disabled (the Intelligence Brief is the single weekly email; findings stay
    // in-app). Brief subscription is handled separately via
    // intelligence_brief_subscribers above. The `subscribers` table remains
    // admin-managed (routes/adminSubscribers.ts) for any manual use.

    logger.info(
      {
        event: "stripe_webhook_entitlement_written",
        stripeEventType: eventType,
        orgId,
        apiKeyId,
        redisTier: entitlement.tier,
        dbLevel: tierToDbLevel(entitlement.tier)
      },
      "stripe webhook processed: entitlement updated"
    );

    respond({ received: true, updated: true });
  } catch (err) {
    logger.error(
      { event: "stripe_webhook_failed", err },
      "stripeWebhook: unhandled error (fail-open)"
    );
    respond({ received: true, updated: false });
  }
}
