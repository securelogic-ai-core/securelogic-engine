import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";

const WINDOW_SECONDS = 60;

export function enforceUsageCap(limitPerMinute: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisReady) {
      return res.status(503).json({ error: "Redis not configured" });
    }

    const apiKey = (req as any).apiKey as string | undefined;
    if (!apiKey) return res.status(401).json({ error: "API key required" });

    const redis = await ensureRedisConnected();

    const key = `usage:${apiKey}:${Math.floor(Date.now() / 1000 / WINDOW_SECONDS)}`;

    const used = await redis.incr(key);

    if (used === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (used > limitPerMinute) {
      const ttl = await redis.ttl(key);
      return res.status(429).json({
        error: "Usage cap exceeded",
        retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS
      });
    }

    next();
  };
}
