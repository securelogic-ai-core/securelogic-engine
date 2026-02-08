import { Router, type Request, type Response } from "express";
import { logger } from "../infra/logger.js";
import { redisReady } from "../infra/redis.js";

import {
  type Tier,
  getEntitlementFromRedis,
  setEntitlementInRedis,
  deleteEntitlementFromRedis,
  type EntitlementRecord
} from "../infra/entitlementStore.js";

const router = Router();

type ApiKeyParams = {
  apiKey: string;
};

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

function isValidApiKeyParam(apiKey: unknown): apiKey is string {
  if (typeof apiKey !== "string") return false;
  const k = apiKey.trim();

  // Enterprise: avoid absurd sizes / path abuse
  if (k.length < 8) return false;
  if (k.length > 128) return false;

  // SecureLogic API keys only
  if (!k.startsWith("sl_")) return false;

  // Strict allowed charset (prevents weird unicode tricks)
  if (!/^sl_[a-z0-9]{16,64}$/i.test(k)) return false;

  return true;
}

function normalizeRecord(
  tier: Tier,
  activeSubscription: boolean
): EntitlementRecord {
  /**
   * Enterprise invariants:
   * - free MUST always be false
   * - paid/admin MUST always be true
   *
   * We ignore client attempts to create inconsistent combos.
   */
  if (tier === "free") {
    return { tier: "free", activeSubscription: false };
  }

  // paid/admin always forced true
  return { tier, activeSubscription: true };
}

/**
 * ENTERPRISE POLICY (Phase 1):
 * Admin entitlements should NOT be assignable via API unless explicitly enabled.
 *
 * If you want to allow this later, set:
 *   ALLOW_ADMIN_TIER_ASSIGNMENT=true
 */
function isAdminTierAssignmentAllowed(): boolean {
  return String(process.env.ALLOW_ADMIN_TIER_ASSIGNMENT ?? "").trim() === "true";
}

function denyAdminTierAssignment(res: Response): void {
  res.status(403).json({ error: "forbidden" });
}

/**
 * IMPORTANT:
 * Admin routes are already protected globally in server.ts:
 *   app.use("/admin", requireAdminKey);
 *   app.use("/admin", adminRateLimit);
 *   app.use("/admin", adminAudit);
 *
 * So this router should assume:
 * - admin is authenticated
 * - but still must be fail-closed on misconfig
 */

/**
 * GET /admin/entitlements/:apiKey
 */
router.get(
  "/admin/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      if (!redisReady) {
        res.status(503).json({ error: "redis_not_configured" });
        return;
      }

      const apiKeyRaw = req.params.apiKey;

      if (!isValidApiKeyParam(apiKeyRaw)) {
        res.status(400).json({ error: "invalid_api_key" });
        return;
      }

      const apiKey = apiKeyRaw.trim();

      const entitlement = await getEntitlementFromRedis(apiKey);

      if (!entitlement) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      /**
       * Enterprise rule:
       * Never echo apiKey back.
       * It is still a secret.
       */
      res.status(200).json({ entitlement });
    } catch (err) {
      logger.error(
        {
          err,
          route: "/admin/entitlements/:apiKey",
          method: "GET"
        },
        "GET /admin/entitlements/:apiKey failed"
      );

      res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PUT /admin/entitlements/:apiKey
 *
 * body:
 * {
 *   "tier": "free" | "paid" | "admin",
 *   "activeSubscription": boolean
 * }
 */
router.put(
  "/admin/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      if (!redisReady) {
        res.status(503).json({ error: "redis_not_configured" });
        return;
      }

      const apiKeyRaw = req.params.apiKey;

      if (!isValidApiKeyParam(apiKeyRaw)) {
        res.status(400).json({ error: "invalid_api_key" });
        return;
      }

      const apiKey = apiKeyRaw.trim();

      const body = req.body as unknown;

      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "invalid_body" });
        return;
      }

      const tierRaw = (body as any).tier as unknown;
      const activeRaw = (body as any).activeSubscription as unknown;

      if (!isTier(tierRaw)) {
        res.status(400).json({ error: "invalid_tier" });
        return;
      }

      if (typeof activeRaw !== "boolean") {
        res.status(400).json({ error: "invalid_activeSubscription" });
        return;
      }

      const tier: Tier = tierRaw;
      const activeSubscription: boolean = activeRaw;

      /**
       * Enterprise default:
       * Block assigning "admin" tier via this endpoint unless explicitly enabled.
       */
      if (tier === "admin" && !isAdminTierAssignmentAllowed()) {
        denyAdminTierAssignment(res);
        return;
      }

      const normalized = normalizeRecord(tier, activeSubscription);

      await setEntitlementInRedis(apiKey, normalized);

      res.status(200).json({
        ok: true,
        entitlement: normalized
      });
    } catch (err) {
      logger.error(
        {
          err,
          route: "/admin/entitlements/:apiKey",
          method: "PUT"
        },
        "PUT /admin/entitlements/:apiKey failed"
      );

      res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * DELETE /admin/entitlements/:apiKey
 */
router.delete(
  "/admin/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      if (!redisReady) {
        res.status(503).json({ error: "redis_not_configured" });
        return;
      }

      const apiKeyRaw = req.params.apiKey;

      if (!isValidApiKeyParam(apiKeyRaw)) {
        res.status(400).json({ error: "invalid_api_key" });
        return;
      }

      const apiKey = apiKeyRaw.trim();

      await deleteEntitlementFromRedis(apiKey);

      /**
       * Enterprise rule:
       * Never echo apiKey back.
       */
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(
        {
          err,
          route: "/admin/entitlements/:apiKey",
          method: "DELETE"
        },
        "DELETE /admin/entitlements/:apiKey failed"
      );

      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;