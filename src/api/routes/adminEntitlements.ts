import { Router, type Request, type Response } from "express";

import {
  type Tier,
  getEntitlementFromRedis,
  setEntitlementInRedis,
  deleteEntitlementFromRedis
} from "../infra/entitlementStore.js";

import { ensureRedisConnected, redisReady } from "../infra/redis.js";

const router = Router();

type ApiKeyParams = {
  apiKey: string;
};

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

/**
 * GET /admin/entitlements/:apiKey
 *
 * NOTE:
 * requireAdminKey is already applied globally in server.ts:
 *   app.use("/admin", requireAdminKey);
 */
router.get(
  "/admin/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      const apiKey = req.params.apiKey;

      if (!apiKey || apiKey.trim().length === 0) {
        res.status(400).json({ error: "invalid_api_key" });
        return;
      }

      const entitlement = await getEntitlementFromRedis(apiKey);

      if (!entitlement) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      res.status(200).json({ apiKey, entitlement });
    } catch (err) {
      console.error("❌ GET /admin/entitlements/:apiKey failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PUT /admin/entitlements/:apiKey
 * body: { tier: "free"|"paid"|"admin", activeSubscription: boolean }
 */
router.put(
  "/admin/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      const apiKey = req.params.apiKey;

      if (!apiKey || apiKey.trim().length === 0) {
        res.status(400).json({ error: "invalid_api_key" });
        return;
      }

      const body = req.body as unknown;

      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "invalid_body" });
        return;
      }

      const tier = (body as any).tier as unknown;
      const activeSubscription = (body as any).activeSubscription as unknown;

      if (!isTier(tier)) {
        res.status(400).json({ error: "invalid_tier" });
        return;
      }

      if (typeof activeSubscription !== "boolean") {
        res.status(400).json({ error: "invalid_activeSubscription" });
        return;
      }

      await setEntitlementInRedis(apiKey, { tier, activeSubscription });

      res.status(200).json({
        ok: true,
        apiKey,
        entitlement: { tier, activeSubscription }
      });
    } catch (err) {
      console.error("❌ PUT /admin/entitlements/:apiKey failed:", err);
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
      const apiKey = req.params.apiKey;

      if (!apiKey || apiKey.trim().length === 0) {
        res.status(400).json({ error: "invalid_api_key" });
        return;
      }

      await deleteEntitlementFromRedis(apiKey);

      res.status(200).json({ ok: true, apiKey });
    } catch (err) {
      console.error("❌ DELETE /admin/entitlements/:apiKey failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * DEBUG: GET /admin/debug/entitlements/:apiKey
 *
 * This proves exactly what Redis contains for the apiKey.
 * It checks BOTH:
 * - entitlement:<apiKey>   (correct)
 * - entitlements:<apiKey>  (old bug)
 *
 * DEV TOOL: keep temporarily until Lemon pipeline is confirmed.
 */
router.get(
  "/admin/debug/entitlements/:apiKey",
  async (req: Request<ApiKeyParams>, res: Response) => {
    try {
      if (!redisReady) {
        res.status(503).json({ error: "redis_not_configured" });
        return;
      }

      const apiKey = req.params.apiKey;

      if (!apiKey || apiKey.trim().length === 0) {
        res.status(400).json({ error: "invalid_api_key" });
        return;
      }

      const redis = await ensureRedisConnected();

      const correctKey = `entitlement:${apiKey}`;
      const oldBugKey = `entitlements:${apiKey}`;

      const correctRaw = await redis.get(correctKey);
      const oldBugRaw = await redis.get(oldBugKey);

      res.status(200).json({
        apiKey,
        keysChecked: {
          correctKey,
          oldBugKey
        },
        raw: {
          correctRaw,
          oldBugRaw
        }
      });
    } catch (err) {
      console.error("❌ GET /admin/debug/entitlements/:apiKey failed:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;