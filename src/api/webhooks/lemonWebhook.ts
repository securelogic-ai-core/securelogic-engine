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
 * Design Goals:
 * - NEVER trust payload shape
 * - NEVER log secrets (apiKey, email, raw payload)
 * - ALWAYS return 200 to Lemon (prevents retry storms)
 * - Fail-closed on entitlement writes if Redis unavailable
 * - Only accept SecureLogic API keys with strict format
 * - Only allow a known set of events to modify entitlements
 * - Minimal leakage in logs (prefix only)
 * =========================================================
 */

/**
 * Safe nested getter:
 * safeGet(obj, "a.b.c") => obj?.a?.b?.c
 */
function safeGet(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;

  try {
    return path.split(".").reduce((acc: any, key) => acc?.[key], obj as any);
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
 * Enterprise key format:
 * - Must start with sl_
 * - Strict charset
 * - Hard length bounds
 * - Prevents unicode abuse
 */
function isValidSecureLogicApiKey(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const k = value.trim();

  // Hard length bounds
  if (k.length < 16 || k.length > 128) return false;

  // Must be sl_*
  if (!k.startsWith("sl_")) return false;

  // Strict charset
  // NOTE: this allows sl_ + 16-64 alphanumeric characters
  if (!/^sl_[a-z0-9]{16,64}$/i.test(k)) return false;

  return true;
}

/**
 * Event → entitlement mapping (strict allow-list)
 */
function classifyEntitlementFromEvent(
  eventName: string
): EntitlementRecord | null {
  /**
   * Enterprise rule:
   * Only these events can change entitlement.
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

/**
 * Extract SecureLogic API key from Lemon payload.
 * This is intentionally defensive: Lemon payload formats vary.
 */
function extractApiKeyFromPayload(payload: any): unknown {
  return (
    safeGet(payload, "meta.custom_data.apiKey") ??
    safeGet(payload, "meta.custom_data.api_key") ??
    safeGet(payload, "data.attributes.custom_data.apiKey") ??
    safeGet(payload, "data.attributes.custom_data.api_key") ??
    safeGet(payload, "data.attributes.custom_data.securelogic_api_key") ??
    safeGet(payload, "data.attributes.custom_data.securelogicApiKey") ??
    null
  );
}

/**
 * Extract event name from Lemon payload.
 */
function extractEventName(payload: any): string {
  return normalizeEventName(
    payload?.meta?.event_name ?? payload?.event_name ?? payload?.event ?? null
  );
}

/**
 * =========================================================
 * Main handler
 * =========================================================
 */
export async function lemonWebhook(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();

  /**
   * IMPORTANT:
   * In production, this route MUST be mounted behind verifyLemonWebhook middleware.
   * This handler assumes signature is already validated.
   */
  try {
    /**
     * Fail-closed on entitlement writes if Redis is not ready.
     * Still return 200 to Lemon to prevent retry storms.
     */
    if (!redisReady) {
      logger.error(
        { route: "/webhooks/lemon" },
        "lemonWebhook: redis not ready (entitlement update blocked)"
      );

      res.status(200).json({ received: true, updated: false });
      return;
    }

    const payload = req.body as any;

    const eventName = extractEventName(payload);
    const apiKeyCandidate = extractApiKeyFromPayload(payload);

    const entitlement = classifyEntitlementFromEvent(eventName);

    /**
     * Minimal logging (no secrets, no raw payload).
     */
    logger.info(
      {
        event: "lemon_webhook_received",
        eventName,
        apiKeyPresent: typeof apiKeyCandidate === "string",
        entitlementAction: entitlement ? entitlement.tier : "ignored"
      },
      "lemon webhook received"
    );

    /**
     * If event isn't recognized, ignore.
     */
    if (!entitlement) {
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    /**
     * If apiKey missing or invalid, ignore.
     */
    if (!isValidSecureLogicApiKey(apiKeyCandidate)) {
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

    const apiKey = apiKeyCandidate;

    /**
     * Enterprise: entitlement write is the ONLY side effect.
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
     * FAIL OPEN:
     * Always return 200 to Lemon to prevent retry storms.
     */
    logger.error({ err }, "lemonWebhook failed");
    res.status(200).json({ received: true, updated: false });
  }
}