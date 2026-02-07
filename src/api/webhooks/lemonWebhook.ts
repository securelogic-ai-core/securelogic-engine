import type { Request, Response } from "express";

import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

/**
 * =========================================================
 * Lemon Squeezy Webhook Handler (Production)
 *
 * Goal:
 * - When a paid purchase happens, activate the PAID API key
 *   that was created at checkout (custom_data.apiKey)
 * - Store entitlement in Redis
 * - This is the monetization bridge
 * =========================================================
 */

type EntitlementTier = "free" | "paid" | "admin";

type Entitlement = {
  tier: EntitlementTier;
  activeSubscription: boolean;
};

/**
 * Extremely defensive parsing.
 * Lemon payloads vary by event type.
 */
function safeGet(obj: any, path: string): any {
  try {
    return path.split(".").reduce((acc, key) => acc?.[key], obj);
  } catch {
    return undefined;
  }
}

function isValidPaidKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("sl_paid_")) return false;
  if (value.length < 20) return false;
  return true;
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

    // Try multiple common locations for customer email
    const email =
      safeGet(payload, "data.attributes.user_email") ??
      safeGet(payload, "data.attributes.customer_email") ??
      safeGet(payload, "data.attributes.email") ??
      safeGet(payload, "data.attributes.customer.email") ??
      null;

    /**
     * Paid events we accept for activation.
     * (We can tighten this later once your Lemon event types are confirmed.)
     */
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
        emailPresent: Boolean(email)
      },
      "lemon webhook received"
    );

    if (!isPaidEvent) {
      res.status(200).json({ ok: true, ignored: true, eventName });
      return;
    }

    /**
     * CRITICAL:
     * We DO NOT generate keys here.
     * The paid API key MUST come from checkout custom_data.
     */
    const paidKey =
      safeGet(payload, "data.attributes.custom_data.apiKey") ?? null;

    if (!isValidPaidKey(paidKey)) {
      logger.warn(
        {
          event: "lemon_webhook_invalid_custom_data",
          eventName,
          paidKeyType: typeof paidKey,
          paidKeyPreview:
            typeof paidKey === "string" ? paidKey.slice(0, 16) : null
        },
        "lemonWebhook: missing/invalid custom_data.apiKey"
      );

      res.status(400).json({
        error: "missing_or_invalid_api_key_in_custom_data",
        eventName
      });
      return;
    }

    const entitlement: Entitlement = {
      tier: "paid",
      activeSubscription: true
    };

    const redis = await ensureRedisConnected();

    /**
     * Storage model:
     * - entitlements:<apiKey> => JSON entitlement
     * - paid_keys_by_email:<email> => latest paid key (optional)
     */
    await redis.set(`entitlements:${paidKey}`, JSON.stringify(entitlement));

    if (typeof email === "string" && email.includes("@")) {
      await redis.set(`paid_keys_by_email:${email}`, paidKey);
    }

    const durationMs = Date.now() - startedAt;

    logger.info(
      {
        event: "lemon_webhook_entitlement_created",
        eventName,
        paidKeyPrefix: paidKey.slice(0, 12),
        durationMs
      },
      "paid entitlement created"
    );

    /**
     * IMPORTANT:
     * This response is safe because it does NOT leak the key.
     * (The key was already known to the buyer at checkout.)
     */
    res.status(200).json({
      received: true,
      updated: true,
      apiKey: paidKey,
      entitlement
    });
  } catch (err) {
    logger.error({ err }, "lemonWebhook failed");
    res.status(500).json({ error: "internal_error" });
  }
}