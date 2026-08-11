import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";
import { resolveThrottleIdentity } from "../infra/clientIp.js";

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

    /**
     * Keyed on the resolved client, not `req.ip`.
     *
     * `req.ip` is a Cloudflare edge node here, so the previous key pooled every
     * caller behind a PoP into one 300/min budget (one heavy client throttles
     * unrelated admins) while a PoP-rotating caller earned a fresh budget each
     * time. It also interpolated a possibly-undefined value directly, which
     * could produce the literal key `admin:rate:undefined`.
     *
     * WINDOW_SECONDS and MAX_REQUESTS are unchanged; only the identity moved.
     */
    const key = `admin:rate:${resolveThrottleIdentity(req).key}`;
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (current > MAX_REQUESTS) {
      return res.status(429).json({ error: "rate_limit_exceeded" });
    }

    next();
  } catch (err) {
    logger.error({ event: "admin_rate_limit_error", err }, "adminRateLimit error");

    // ✅ FAIL OPEN in dev
    if (process.env.NODE_ENV !== "production") {
      return next();
    }

    return res.status(500).json({ error: "rate_limit_failed" });
  }
}