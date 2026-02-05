import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const LIMITS: Record<Tier, number> = {
  free: 50,
  paid: 10_000,
  admin: Number.POSITIVE_INFINITY
};

const WINDOW_SECONDS = 60 * 60 * 24; // 24 hours

export async function enforceUsageCap(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tier = (req as any).entitlement as Tier | undefined;
  const apiKey = (req as any).apiKey as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "API key required (enforceUsageCap)" });
    return;
  }

  if (!tier || !["free", "paid", "admin"].includes(tier)) {
    res.status(500).json({ error: "Missing entitlement tier" });
    return;
  }

  if (tier === "admin") {
    next();
    return;
  }

  const key = `usage:${tier}:${apiKey}`;

  try {
    const used = await redis.incr(key);

    if (used === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (used > LIMITS[tier]) {
      const ttl = await redis.ttl(key);

      res.status(402).json({
        error: "Usage cap exceeded",
        tier,
        limit: LIMITS[tier],
        windowSeconds: WINDOW_SECONDS,
        resetSeconds: ttl > 0 ? ttl : null
      });
      return;
    }

    next();
  } catch (err) {
    console.error("❌ enforceUsageCap failed:", err);

    res.status(503).json({
      error: "redis_unavailable",
      dependency: "redis"
    });
  }
}