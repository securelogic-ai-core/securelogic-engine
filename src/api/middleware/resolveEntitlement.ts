import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

import {
  getEntitlementFromRedis,
  type EntitlementRecord,
  type Tier
} from "../infra/entitlementStore.js";

/**
 * resolveEntitlement (Enterprise-grade)
 *
 * RULES:
 * - Source of truth: Redis entitlements
 * - Never trusts client headers for tier/subscription
 * - Never logs apiKey
 * - Fail-open for entitlement resolution (default = free)
 * - Admin keys are handled separately (requireAdminKey middleware)
 */

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

function safeTier(value: unknown): Tier {
  return isTier(value) ? value : "free";
}

function safeBool(value: unknown): boolean {
  return value === true;
}

function normalizeEntitlement(raw: EntitlementRecord | null): EntitlementRecord {
  if (!raw) {
    return { tier: "free", activeSubscription: false };
  }

  const tier = safeTier(raw.tier);
  const activeSubscription = safeBool(raw.activeSubscription);

  /**
   * Enterprise invariants:
   * - free => activeSubscription must be false
   * - paid/admin => activeSubscription must be true
   */
  if (tier === "free") {
    return { tier: "free", activeSubscription: false };
  }

  return { tier, activeSubscription: true };
}

export async function resolveEntitlement(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = (req as any).apiKey as string | undefined;

    /**
     * If apiKey is missing, do nothing.
     * requireApiKey should have blocked already.
     */
    if (!apiKey) {
      (req as any).entitlement = "free";
      (req as any).activeSubscription = false;
      next();
      return;
    }

    /**
     * Default: free.
     * This is fail-open for entitlement lookup.
     */
    let resolved: EntitlementRecord = {
      tier: "free",
      activeSubscription: false
    };

    try {
      const fromRedis = await getEntitlementFromRedis(apiKey);
      resolved = normalizeEntitlement(fromRedis);
    } catch (err) {
      /**
       * Fail-open:
       * If Redis fails, we treat as free.
       * Subscription gating happens later in requireSubscription.
       */
      logger.warn(
        {
          err,
          route: req.originalUrl,
          method: req.method
        },
        "resolveEntitlement: redis lookup failed (defaulting to free)"
      );
    }

    /**
     * Attach normalized fields.
     * IMPORTANT:
     * req.entitlement is the TIER, not the full record.
     */
    (req as any).entitlement = resolved.tier;
    (req as any).activeSubscription = resolved.activeSubscription;

    next();
  } catch (err) {
    /**
     * Absolute fail-open:
     * entitlement resolution must never crash request flow.
     */
    logger.warn(
      {
        err,
        route: req.originalUrl,
        method: req.method
      },
      "resolveEntitlement failed (fail-open)"
    );

    (req as any).entitlement = "free";
    (req as any).activeSubscription = false;

    next();
  }
}