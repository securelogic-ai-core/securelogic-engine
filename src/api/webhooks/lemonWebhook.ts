import type { Request, Response } from "express";

import { redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

import {
  setEntitlementInRedis,
  type EntitlementRecord
} from "../infra/entitlementStore.js";

/**
 * =========================================================
 * Lemon Squeezy Webhook Handler (Enterprise / Production)
 *
 * Rules:
 * - NEVER trust payload shape
 * - NEVER log secrets (apiKey, email, raw payload)
 * - ALWAYS return 200 to Lemon (prevents retry storms)
 * - Fail-closed on entitlement writes if Redis unavailable
 * - Only accept SecureLogic API keys with strict format
 * =========================================================
 */

function safeGet(obj: any, path: string): any {
  try {
    return path.split(".").reduce((acc, key) => acc?.[key], obj);
  } catch {
    return undefined;
  }
}

function normalizeEventName(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const v = value.trim().toLowerCase();
  return v.length ? v : "unknown";
}

/**
 * Enterprise key format.
 * - Strict
 * - ASCII only
 * - Prevents weird unicode / abuse
 */
function isValidSecureLogicApiKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const k = value.trim();

  // Hard length bounds
  if (k.length < 16 || k.length > 128) return false;

  // Must be sl_*
  if (!k.startsWith("sl_")) return false;

  // Strict charset (enterprise)
  if (!/^sl_[a-z0-9]{16,64}$/i.test(k)) return false;

  return true;
}

function classifyEntitlementFromEvent(
  eventName: string
): EntitlementRecord | null {
  /**
   * Enterprise rule:
   * Only a known set of events may change entitlement.
   * Everything else is ignored.
   */

  const paidEvents = new Set([
    "subscription_created",
    "subscription_updated",
    "subscription_resumed",
    "subscription_payment_success",
    "order_created"
  ]);

  const cancelEvents = new Set([
    "subscription_cancelled",
    "subscription_expired",
    "subscription_refunded",
    "order_refunded"
  ]);

  if (paidEvents.has(eventName)) {
    return { tier: "paid", activeSubscription: true };
  }

  if (cancelEvents.has(eventName)) {
    return { tier: "free", activeSubscription: false };
  }

  return null;
}

export async function lemonWebhook(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();

  /**
   * IMPORTANT:
   * In production, this route is mounted behind verifyLemonWebhook middleware.
   * This handler assumes signature is already validated.
   */
  try {
    if (!redisReady) {
      logger.error(
        { route: "/webhooks/lemon" },
        "lemonWebhook: redis not configured (fail-closed)"
      );

      // Still return 200 to Lemon (no retry storm)
      res.status(200).json({ received: true, updated: false });
      return;
    }

    const payload = req.body as any;

    const eventName = normalizeEventName(
      payload?.meta?.event_name ?? payload?.event_name ?? payload?.event
    );

    /**
     * Extract apiKey from known Lemon custom_data locations.
     */
    const apiKey =
      safeGet(payload, "meta.custom_data.apiKey") ??
      safeGet(payload, "data.attributes.custom_data.apiKey") ??
      safeGet(payload, "data.attributes.custom_data.api_key") ??
      safeGet(payload, "data.attributes.custom_data.securelogic_api_key") ??
      null;

    const entitlement = classifyEntitlementFromEvent(eventName);

    logger.info(
      {
        event: "lemon_webhook_received",
        eventName,
        apiKeyPresent: typeof apiKey === "string",
        entitlementAction: entitlement ? entitlement.tier : "ignored"
      },
      "lemon webhook received"
    );

    /**
     * If we don't recognize the event, ignore it.
     */
    if (!entitlement) {
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    /**
     * If apiKey missing/invalid, ignore (but return 200).
     */
    if (!isValidSecureLogicApiKey(apiKey)) {
      logger.warn(
        {
          event: "lemon_webhook_invalid_api_key",
          eventName
        },
        "lemon webhook ignored: missing/invalid apiKey"
      );

      res.status(200).json({ received: true, ignored: true });
      return;
    }

    /**
     * Enterprise: entitlement write is the only side effect.
     */
    await setEntitlementInRedis(apiKey, entitlement);

    const durationMs = Date.now() - startedAt;

    logger.info(
      {
        event: "lemon_webhook_entitlement_written",
        eventName,
        apiKeyPrefix: apiKey.slice(0, 6),
        tier: entitlement.tier,
        durationMs
      },
      "lemon webhook processed: entitlement updated"
    );

    res.status(200).json({
      received: true,
      updated: true
    });
  } catch (err) {
    /**
     * FAIL OPEN (webhook stability):
     * We return 200 to prevent Lemon retry storms.
     */
    logger.error({ err }, "lemonWebhook failed");
    res.status(200).json({ received: true, updated: false });
  }
}