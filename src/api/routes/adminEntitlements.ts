import { Router, type Request, type Response } from "express";
import { requireAdminKey } from "../middleware/requireAdminKey.js";

import {
  type Tier,
  getEntitlementFromRedis,
  setEntitlementInRedis,
  deleteEntitlementFromRedis
} from "../infra/entitlementStore.js";

const router = Router();

type ApiKeyParams = {
  apiKey: string;
};

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

/**
 * GET /admin/entitlements/:apiKey
 */
router.get(
  "/admin/entitlements/:apiKey",
  requireAdminKey,
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
  requireAdminKey,
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
  requireAdminKey,
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

export default router;