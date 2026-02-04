import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const LIMITS: Record<Tier, number> = {
  free: 50,
  paid: 10_000,
  admin: Number.POSITIVE_INFINITY
};

// Daily usage window
const WINDOW_SECONDS = 60 * 60 * 24;

function getTier(req: Request): Tier {
  return ((req as any).entitlement as Tier) ?? "free";
}

function getApiKey(req: Request): string {
  // 🔒 Phase 6.2: canonical identity ONLY
  return ((req as any).identity?.apiKey as string | undefined) ?? "";
}

export async function enforceUsageCap(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tier = getTier(req);

    // Admins are uncapped and do not consume counters
    if (tier === "admin") {
      next();
      return;
    }

    const apiKey = getApiKey(req);
    if (!apiKey) {
      res.status(401).json({ error: "Missing API key" });
      return;
    }

    const limit = LIMITS[tier];
    const key = `usage:${tier}:${apiKey}`;

    const used = await redis.incr(key);

    // First hit sets the daily TTL
    if (used === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (used > limit) {
      res.status(402).json({
        error: "Usage cap exceeded",
        tier,
        limit
      });
      return;
    }

    next();
  } catch (err) {
    console.error("❌ Usage cap enforcement failed:", err);
    res.status(500).json({ error: "Usage enforcement failed" });
  }
}