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

/**
 * Enterprise hardening goals:
 * - Fail closed if Redis is not configured
 * - Strict apiKey param validation (prevents abuse + unicode tricks)
 * - Never echo apiKey back to the client
 * - Admin tier assignment is blocked by default (explicit opt-in only)
 * - Defensive body parsing
 * - Consistent error shapes
 *
 * IMPORTANT MOUNTING RULE:
 * If server.ts does:
 *   app.use("/admin", adminEntitlementsRouter)
 *
 * then routes here MUST be:
 *   router.get("/entitlements/:apiKey")
 * NOT:
 *   router.get("/admin/entitlements/:apiKey")
 */

type ApiKeyParams = { apiKey: string };

const MIN_API_KEY_LEN = 8;
const MAX_API_KEY_LEN = 128;

// SecureLogic API keys: sl_ + 16..64 alnum
const API_KEY_RE = /^sl_[a-z0-9]{16,64}$/i;

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

function isValidApiKeyParam(apiKey: unknown): apiKey is string {
  if (typeof apiKey !== "string") return false;

  const k = apiKey.trim();

  // bounds
  if (k.length < MIN_API_KEY_LEN) return false;
  if (k.length > MAX_API_KEY_LEN) return false;

  // fast prefix filter
  if (!k.startsWith("sl_")) return false;

  // strict allowed charset + length
  if (!API_KEY_RE.test(k)) return false;

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
   */
  if (tier === "free") {
    return { tier: "free", activeSubscription: false };
  }

  // paid/admin always forced true
  return { tier, activeSubscription: true };
}

/**
 * ENTERPRISE POLICY:
 * Admin tier assignment should NOT be possible via API unless explicitly enabled.
 */
function isAdminTierAssignmentAllowed(): boolean {
  return String(process.env.ALLOW_ADMIN_TIER_ASSIGNMENT ?? "").trim() === "true";
}

function denyAdminTierAssignment(res: Response): void {
  res.status(403).json({ error: "forbidden" });
}

function badRequest(res: Response, code: string): void {
  res.status(400).json({ error: code });
}

function notConfigured(res: Response): void {
  res.status(503).json({ error: "redis_not_configured" });
}

/**
 * GET /admin/entitlements/:apiKey
 * (router is mounted at /admin)
 */
router.get(
  "/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      if (!redisReady) {
        notConfigured(res);
        return;
      }

      const apiKeyRaw = req.params.apiKey;

      if (!isValidApiKeyParam(apiKeyRaw)) {
        badRequest(res, "invalid_api_key");
        return;
      }

      const apiKey = apiKeyRaw.trim();

      const entitlement = await getEntitlementFromRedis(apiKey);

      if (!entitlement) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      // Never echo apiKey back
      res.status(200).json({ entitlement });
    } catch (err) {
      logger.error(
        {
          err,
          route: "/entitlements/:apiKey",
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
  "/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      if (!redisReady) {
        notConfigured(res);
        return;
      }

      const apiKeyRaw = req.params.apiKey;

      if (!isValidApiKeyParam(apiKeyRaw)) {
        badRequest(res, "invalid_api_key");
        return;
      }

      const apiKey = apiKeyRaw.trim();

      const body: unknown = req.body;

      if (body === null || typeof body !== "object") {
        badRequest(res, "invalid_body");
        return;
      }

      const tierRaw = (body as any).tier as unknown;
      const activeRaw = (body as any).activeSubscription as unknown;

      if (!isTier(tierRaw)) {
        badRequest(res, "invalid_tier");
        return;
      }

      if (typeof activeRaw !== "boolean") {
        badRequest(res, "invalid_activeSubscription");
        return;
      }

      const tier: Tier = tierRaw;
      const activeSubscription: boolean = activeRaw;

      // Block admin tier assignment unless explicitly enabled
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
          route: "/entitlements/:apiKey",
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
  "/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      if (!redisReady) {
        notConfigured(res);
        return;
      }

      const apiKeyRaw = req.params.apiKey;

      if (!isValidApiKeyParam(apiKeyRaw)) {
        badRequest(res, "invalid_api_key");
        return;
      }

      const apiKey = apiKeyRaw.trim();

      await deleteEntitlementFromRedis(apiKey);

      // Never echo apiKey back
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(
        {
          err,
          route: "/entitlements/:apiKey",
          method: "DELETE"
        },
        "DELETE /admin/entitlements/:apiKey failed"
      );

      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;