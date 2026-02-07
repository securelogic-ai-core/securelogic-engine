import type { Request, Response } from "express";

import { redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

import {
  setEntitlementInRedis,
  type EntitlementRecord
} from "../infra/entitlementStore.js";

/**
 * =========================================================
 * Lemon Squeezy Webhook Handler (Production)
 *
 * Goal:
 * - When a paid purchase happens, activate entitlement for
 *   the apiKey provided in Lemon custom_data.apiKey
 *
 * This is the monetization bridge.
 * =========================================================
 */

function safeGet(obj: any, path: string): any {
  try {
    return path.split(".").reduce((acc, key) => acc?.[key], obj);
  } catch {
    return undefined;
  }
}

export async function lemonWebhook(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();

  try {
    if (!redisReady) {
      logger.error(
        { route: req.originalUrl },
        "lemonWebhook: redis not configured"
      );
      res.status(503).json({ error: "redis_not_configured" });
      return;
    }

    const payload = req.body as any;

    const eventName =
      payload?.meta?.event_name ??
      payload?.event_name ??
      payload?.event ??
      "unknown";

    // The ONLY thing we actually need for activation:
    const apiKey =
      safeGet(payload, "data.attributes.custom_data.apiKey") ??
      safeGet(payload, "data.attributes.custom_data.api_key") ??
      safeGet(payload, "data.attributes.custom_data.securelogic_api_key") ??
      null;

    // Optional: useful for logging later
    const email =
      safeGet(payload, "data.attributes.user_email") ??
      safeGet(payload, "data.attributes.customer_email") ??
      safeGet(payload, "data.attributes.email") ??
      safeGet(payload, "data.attributes.customer.email") ??
      null;

    const paidEvents = new Set([
      "subscription_created",
      "subscription_updated",
      "subscription_resumed",
      "subscription_payment_success",
      "order_created"
    ]);

    const isPaidEvent = paidEvents.has(String(eventName));

    logger.info(
      {
        event: "lemon_webhook_received",
        eventName,
        apiKeyPresent: typeof apiKey === "string",
        emailPresent: typeof email === "string"
      },
      "lemon webhook received"
    );

    // Ignore non-paid events
    if (!isPaidEvent) {
      res.status(200).json({ received: true, ignored: true, eventName });
      return;
    }

    if (typeof apiKey !== "string" || !apiKey.startsWith("sl_paid_")) {
      logger.warn(
        {
          event: "lemon_webhook_missing_api_key",
          eventName,
          apiKey
        },
        "lemon webhook missing valid custom_data.apiKey"
      );

      res.status(400).json({ error: "missing_custom_data_apiKey" });
      return;
    }

    const entitlement: EntitlementRecord = {
      tier: "paid",
      activeSubscription: true
    };

    // ✅ IMPORTANT: uses entitlement:${apiKey} (singular)
    await setEntitlementInRedis(apiKey, entitlement);

    const durationMs = Date.now() - startedAt;

    logger.info(
      {
        event: "lemon_webhook_entitlement_activated",
        eventName,
        apiKeyPrefix: apiKey.slice(0, 14),
        durationMs
      },
      "paid entitlement activated"
    );

    res.status(200).json({
      received: true,
      updated: true,
      apiKey,
      entitlement
    });
  } catch (err) {
    logger.error({ err }, "lemonWebhook failed");
    res.status(500).json({ error: "internal_error" });
  }
}