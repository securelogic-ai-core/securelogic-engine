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
 * Determines whether a subscription event should grant or revoke entitlement.
 * For `customer.subscription.updated`, the subscription status is the deciding factor.
 */
function classifySubscriptionEvent(
  eventType: string,
  subscription: Stripe.Subscription | null
): EntitlementRecord | null {
  if (REVOKE_EVENTS.has(eventType)) {
    return { tier: "free", activeSubscription: false };
  }

  if (eventType === "customer.subscription.updated" && subscription) {
    const status = subscription.status;
    if (status === "active" || status === "trialing") {
      return { tier: "paid", activeSubscription: true };
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
    return { tier: "paid", activeSubscription: true };
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
 * Best-effort sync of entitlement level to Postgres api_keys table.
 * Errors are logged but never thrown.
 */
async function syncToDb(
  apiKeyId: string,
  entitlement: EntitlementRecord
): Promise<void> {
  const level =
    entitlement.tier === "paid" || entitlement.tier === "admin"
      ? "premium"
      : "starter";

  try {
    const result = await pg.query(
      `UPDATE api_keys SET entitlement_level = $1 WHERE id = $2`,
      [level, apiKeyId]
    );

    const rows = result.rowCount ?? 0;

    if (rows === 0) {
      logger.warn(
        {
          event: "stripe_webhook_db_sync_no_match",
          apiKeyId,
          level
        },
        "stripeWebhook: api_keys row not found — DB entitlement not updated"
      );
    } else {
      logger.info(
        {
          event: "stripe_webhook_db_sync_ok",
          apiKeyId,
          level
        },
        "stripeWebhook: api_keys.entitlement_level updated"
      );
    }
  } catch (err) {
    logger.error(
      { event: "stripe_webhook_db_sync_failed", err },
      "stripeWebhook: failed to sync entitlement to DB (non-fatal)"
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

    // Determine what entitlement action to take
    const subscription =
      eventType.startsWith("customer.subscription.")
        ? (event.data.object as Stripe.Subscription)
        : null;

    const entitlement = classifySubscriptionEvent(eventType, subscription);

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

    // Write to Redis (supplementary cache) then sync to Postgres (primary)
    await setEntitlementInRedis(apiKeyId, entitlement);
    await syncToDb(apiKeyId, entitlement);

    logger.info(
      {
        event: "stripe_webhook_entitlement_written",
        stripeEventType: eventType,
        apiKeyId,
        tier: entitlement.tier
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
