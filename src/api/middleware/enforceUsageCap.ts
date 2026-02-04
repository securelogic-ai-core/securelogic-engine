import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const LIMITS: Record<Tier, number> = {
  free: 50,
  paid: 10_000,
  admin: Number.POSITIVE_INFINITY
};

const WINDOW_SECONDS = 60 * 60 * 24;

export async function enforceUsageCap(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tier = (req as any).entitlement as Tier;
    const apiKey = (req as any).identity?.apiKey as string | undefined;

    if (!apiKey) {
      res.status(401).json({ error: "API key required" });
      return;
    }

    if (tier === "admin") {
      next();
      return;
    }

    const key = `usage:${tier}:${apiKey}`;
    const used = await redis.incr(key);

    if (used === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (used > LIMITS[tier]) {
      res.status(402).json({
        error: "Usage cap exceeded",
        tier,
        limit: LIMITS[tier]
      });
      return;
    }

    next();
  } catch (err) {
    console.error("❌ Usage cap enforcement failed:", err);
    res.status(500).json({ error: "Usage enforcement failed" });
  }
}