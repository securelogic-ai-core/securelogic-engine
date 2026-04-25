import type { Request, Response } from "express";
import Stripe from "stripe";

import { getStripe } from "../infra/stripeClient.js";
import { logger } from "../infra/logger.js";
import { pg } from "../infra/postgres.js";
import {
  setEntitlementInRedis,
  type EntitlementRecord
} from "../infra/entitlementStore.js";

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
 * Resolves the SecureLogic entitlement tier from the Stripe event metadata.
 *
 * Returns a value from the Redis Tier union ("professional" | "paid"):
 *   - "professional" → Brief tier (entitlement_level="professional")
 *       raw: "professional", "teams"
 *   - "paid"         → full platform tier (entitlement_level="premium")
 *       raw: "platform", "platform_annual", legacy "team"/"paid"/"admin"
 *
 * Unknown raw values are logged as stripe_unknown_tier and default to "paid"
 * for forward compatibility with legacy events that predate tier metadata.
 */
function resolveTierFromMetadata(event: Stripe.Event): "professional" | "paid" {
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
 * Extracts the raw subscription tier string from checkout or subscription metadata.
 * Returns 'professional' or 'team' when present; null for legacy/unknown events.
 *
 * This is distinct from resolveTierFromMetadata(): that function normalises 'team'
 * → 'paid' for Redis/entitlement purposes. This function preserves the original
 * value so it can be stored in stripe_subscription_tier for future feature gating.
 */
function extractRawSubscriptionTier(event: Stripe.Event): string | null {
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
 * Best-effort sync of entitlement level (and optionally stripe_customer_id)
 * to the Postgres api_keys table. Errors are logged but never thrown.
 *
 * The two updates (api_keys.entitlement_level + organizations.plan) must
 * stay in lock-step: if the second fails after the first succeeds, the
 * dashboard will show divergent state (key upgraded, org still starter).
 * They run in a single transaction so either both land or neither does.
 *
 * stripe_customer_id is written here as a belt-and-suspenders fallback.
 * The primary write happens at checkout creation time in billing.ts so
 * portal access never depends on webhook delivery. This write uses
 * ON CONFLICT DO NOTHING semantics via COALESCE to avoid overwriting
 * an already-stored customer ID.
 */
async function syncToDb(
  apiKeyId: string,
  entitlement: EntitlementRecord,
  customerId: string | null,
  rawSubscriptionTier: string | null
): Promise<void> {
  const level = tierToDbLevel(entitlement.tier);

  // organizations.plan uses the same vocabulary as entitlement_level for paid tiers.
  // starter is the floor for downgrades; standard is not written by billing.
  const orgPlan =
    level === "professional" ? "professional" :
    level === "premium"      ? "premium"      : "starter";

  // On a successful grant, also clear any stale payment_failed_at stamp.
  const clearPaymentFailed = entitlement.activeSubscription;

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    const keyResult = await client.query(
      `
      UPDATE api_keys
      SET
        entitlement_level        = $1,
        stripe_customer_id       = COALESCE(stripe_customer_id, $3),
        stripe_subscription_tier = COALESCE($4, stripe_subscription_tier),
        payment_failed_at        = CASE WHEN $5 THEN NULL ELSE payment_failed_at END
      WHERE id = $2
      `,
      [level, apiKeyId, customerId, rawSubscriptionTier, clearPaymentFailed]
    );

    await client.query(
      `
      UPDATE organizations
      SET plan = $1
      WHERE id = (SELECT organization_id FROM api_keys WHERE id = $2 LIMIT 1)
      `,
      [orgPlan, apiKeyId]
    );

    await client.query("COMMIT");

    const rows = keyResult.rowCount ?? 0;

    if (rows === 0) {
      logger.warn(
        { event: "stripe_webhook_db_sync_no_match", apiKeyId, level },
        "stripeWebhook: api_keys row not found — DB entitlement not updated"
      );
    } else {
      logger.info(
        { event: "stripe_webhook_db_sync_ok", apiKeyId, level, customerId },
        "stripeWebhook: api_keys.entitlement_level updated"
      );
      logger.info(
        { event: "stripe_webhook_org_plan_synced", apiKeyId, orgPlan },
        "stripeWebhook: organizations.plan synced"
      );
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
 * Best-effort upsert of subscriber record when entitlement is granted or revoked.
 *
 * When a subscriber pays: ensure they exist in the subscribers table with
 * tier = 'paid' so the newsletter delivery pipeline includes them.
 * When a subscription is cancelled: downgrade to tier = 'free'.
 *
 * The email must be sourced from the Stripe Customer record. If the customer
 * has no email on file (rare in B2B flows), the sync is skipped with a warning.
 *
 * Errors are non-fatal — a subscriber sync failure must never block the webhook.
 */
async function syncSubscriber(
  customerId: string | null,
  entitlement: EntitlementRecord
): Promise<void> {
  if (!customerId) return;

  let email: string | null = null;

  try {
    const customer = await getStripe().customers.retrieve(customerId);

    if (customer.deleted) {
      logger.warn(
        { event: "stripe_webhook_customer_deleted", customerId },
        "stripeWebhook: Stripe customer is deleted — skipping subscriber sync"
      );
      return;
    }

    email = customer.email ?? null;
  } catch (err) {
    logger.error(
      { event: "stripe_webhook_customer_fetch_failed", customerId, err },
      "stripeWebhook: failed to fetch Stripe customer for subscriber sync (non-fatal)"
    );
    return;
  }

  if (!email) {
    logger.warn(
      { event: "stripe_webhook_no_customer_email", customerId },
      "stripeWebhook: Stripe customer has no email — subscriber table not updated"
    );
    return;
  }

  const subscriberTier =
    entitlement.tier === "paid" ||
    entitlement.tier === "professional" ||
    entitlement.tier === "admin"
      ? "paid"
      : "free";

  const subscriberStatus = "active";

  try {
    await pg.query(
      `
      INSERT INTO subscribers (email, tier, status, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (email) DO UPDATE
        SET tier   = EXCLUDED.tier,
            status = EXCLUDED.status
      `,
      [email.toLowerCase().trim(), subscriberTier, subscriberStatus]
    );

    logger.info(
      { event: "stripe_webhook_subscriber_synced", customerId, tier: subscriberTier },
      "stripeWebhook: subscriber record synced"
    );
  } catch (err) {
    logger.error(
      { event: "stripe_webhook_subscriber_sync_failed", customerId, err },
      "stripeWebhook: failed to sync subscriber record (non-fatal)"
    );
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
 * Handles invoice.payment_failed: stamps payment_failed_at on the api_key row
 * so the billing UI can surface a dunning state. Does NOT revoke access — Stripe
 * will send customer.subscription.updated (past_due) and eventually
 * customer.subscription.deleted after its retry cycle, which will revoke.
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
      UPDATE api_keys
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

    // Handle payment failure first — separate action from grant/revoke flow
    if (PAYMENT_FAILED_EVENTS.has(eventType)) {
      await handlePaymentFailed(event);
      respond({ received: true, updated: true });
      return;
    }

    // Determine what entitlement action to take
    const subscription =
      eventType.startsWith("customer.subscription.")
        ? (event.data.object as Stripe.Subscription)
        : null;

    const metadataTier = resolveTierFromMetadata(event);
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

    // Extract customer ID and raw tier for DB sync
    const customerId = extractCustomerId(event);
    const rawSubscriptionTier = extractRawSubscriptionTier(event);

    // Write to Redis (supplementary cache) then sync to Postgres (primary)
    await setEntitlementInRedis(apiKeyId, entitlement);
    await syncToDb(apiKeyId, entitlement, customerId, rawSubscriptionTier);

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

      await cancelPriorBriefSubscriptions(customerId, newSubscriptionId);
    }

    // Sync subscriber record so newsletter delivery includes this subscriber.
    // Fire-and-forget wrapper: errors logged inside syncSubscriber, never thrown.
    syncSubscriber(customerId, entitlement).catch((err) => {
      logger.error(
        { event: "stripe_webhook_subscriber_sync_unexpected", err },
        "stripeWebhook: unexpected error in subscriber sync (non-fatal)"
      );
    });

    logger.info(
      {
        event: "stripe_webhook_entitlement_written",
        stripeEventType: eventType,
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
