import type { Request, Response } from "express";
import crypto from "crypto";

import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

/**
 * =========================================================
 * Lemon Squeezy Webhook Handler (Production)
 *
 * Goal:
 * - When a paid purchase happens, generate a paid API key
 * - Store entitlement in Redis
 * - This is the monetization bridge
 * =========================================================
 */

type EntitlementTier = "free" | "paid" | "admin";

type Entitlement = {
  tier: EntitlementTier;
  activeSubscription: boolean;
};

function generatePaidKey(): string {
  // 32 hex bytes -> 64 chars, consistent with your key style
  const raw = crypto.randomBytes(16).toString("hex");
  return `sl_paid_${raw}`;
}

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

export async function lemonWebhook(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();

  try {
    if (!redisReady) {
      // Revenue system depends on Redis.
      // But we still must NOT crash.
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
     * For now: we only care about events that represent
     * a paid subscription being active.
     *
     * We'll tighten the exact mapping later once you confirm
     * your Lemon event names.
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
      // Not an event we use for entitlements yet.
      res.status(200).json({ ok: true, ignored: true, eventName });
      return;
    }

    // Generate a brand new paid key
    const paidKey = generatePaidKey();

    const entitlement: Entitlement = {
      tier: "paid",
      activeSubscription: true
    };

    const redis = await ensureRedisConnected();

    /**
     * Storage model:
     * - entitlements:<apiKey> => JSON entitlement
     * - paid_keys_by_email:<email> => latest paid key (optional)
     *
     * We keep it simple and production-safe.
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
     * In production, you will NOT want to return the paid key
     * publicly here.
     *
     * But for now, while you are validating the pipeline,
     * returning it makes testing possible.
     */
    res.status(200).json({
      ok: true,
      createdPaidKey: paidKey,
      entitlement
    });
  } catch (err) {
    logger.error({ err }, "lemonWebhook failed");
    res.status(500).json({ error: "internal_error" });
  }
}