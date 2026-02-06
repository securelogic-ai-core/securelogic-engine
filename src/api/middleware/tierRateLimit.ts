import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const WINDOW_SECONDS = 60;

// Hard timeout so Redis can NEVER hang the API
const REDIS_TIMEOUT_MS = 1200;

function getTierLimitPerMinute(tier: Tier): number {
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

/**
 * Promise timeout wrapper.
 * If Redis stalls, we fail-open and let the request through.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`redis_timeout_after_${ms}ms`));
      }, ms).unref?.() ?? setTimeout(() => reject(new Error(`redis_timeout_after_${ms}ms`)), ms);
    })
  ]);
}

export async function tierRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    /**
     * PROD-SAFE: If Redis is not configured, fail open.
     * Rate limiting should never take down the API.
     */
    if (!redisReady) {
      next();
      return;
    }

    const apiKey = (req as any).apiKey as string | undefined;

    /**
     * If the API key is missing, DO NOT rate limit here.
     * requireApiKey should already have blocked the request.
     */
    if (!apiKey) {
      next();
      return;
    }

    const tier = ((req as any).entitlement ?? "free") as Tier;
    const limitPerMinute = getTierLimitPerMinute(tier);

    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

    const windowId = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `rate:${apiKey}:${windowId}`;

    /**
     * Use MULTI so incr + expire happen atomically.
     * Avoid extra round trips.
     */
    const [incrRes, expireRes] = await withTimeout(
      redis.multi().incr(key).expire(key, WINDOW_SECONDS).exec(),
      REDIS_TIMEOUT_MS
    );

    const count = Number(incrRes);

    /**
     * If Redis returned something weird, fail open.
     */
    if (!Number.isFinite(count)) {
      next();
      return;
    }

    if (count > limitPerMinute) {
      /**
       * Only fetch TTL when needed (rate limit exceeded).
       * Still time-boxed.
       */
      let ttl = WINDOW_SECONDS;

      try {
        const ttlRes = await withTimeout(redis.ttl(key), REDIS_TIMEOUT_MS);
        if (typeof ttlRes === "number" && ttlRes > 0) ttl = ttlRes;
      } catch {
        // ignore ttl failures
      }

      res.setHeader("Retry-After", String(ttl));

      res.status(429).json({
        error: "rate_limit_exceeded",
        tier,
        limitPerMinute,
        retryAfterSeconds: ttl
      });
      return;
    }

    next();
  } catch (err) {
    /**
     * PROD-SAFE: Fail open.
     * Rate limiting is not allowed to break the API.
     */
    console.error("⚠️ tierRateLimit failed (fail-open):", err);
    next();
  }
}