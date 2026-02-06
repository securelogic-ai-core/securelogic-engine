import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const WINDOW_SECONDS = 60;

function getUsageCapPerMinute(tier: Tier): number {
  switch (tier) {
    case "free":
      return 20;
    case "paid":
      return 120;
    case "admin":
      return 600;
    default:
      return 20;
  }
}

export function enforceUsageCap() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisReady) {
      return res.status(503).json({ error: "Redis not configured" });
    }

    const apiKey = (req as any).apiKey as string | undefined;
    if (!apiKey) {
      return res.status(401).json({ error: "API key required" });
    }

    const tier = ((req as any).entitlement ?? "free") as Tier;
    const limitPerMinute = getUsageCapPerMinute(tier);

    const redis = await ensureRedisConnected();

    const key = `usage:${apiKey}:${Math.floor(
      Date.now() / 1000 / WINDOW_SECONDS
    )}`;

    const used = await redis.incr(key);

    if (used === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (used > limitPerMinute) {
      const ttl = await redis.ttl(key);

      return res.status(429).json({
        error: "usage_cap_exceeded",
        tier,
        limitPerMinute,
        retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS
      });
    }

    next();
  };
}