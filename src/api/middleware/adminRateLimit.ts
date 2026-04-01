import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 300;

export async function adminRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // ✅ FAIL OPEN IN DEV (no Redis)
    if (!redisReady && process.env.NODE_ENV !== "production") {
      return next();
    }

    // ❌ FAIL CLOSED in production
    if (!redisReady) {
      return res.status(503).json({ error: "rate_limit_unavailable" });
    }

    const redis = await ensureRedisConnected();

    const key = `admin:rate:${req.ip}`;
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (current > MAX_REQUESTS) {
      return res.status(429).json({ error: "rate_limit_exceeded" });
    }

    next();
  } catch (err) {
    console.error("adminRateLimit error:", err);

    // ✅ FAIL OPEN in dev
    if (process.env.NODE_ENV !== "production") {
      return next();
    }

    return res.status(500).json({ error: "rate_limit_failed" });
  }
}