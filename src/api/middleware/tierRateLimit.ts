import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

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
 * If Redis stalls, we FAIL OPEN and let the request through.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`redis_timeout_after_${ms}ms`));
    }, ms);

    // Prevent holding the event loop open
    timeoutId.unref?.();
  });

  return Promise.race([p, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export async function tierRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    /**
     * Enterprise rule:
     * Rate limiting should NEVER take down the API.
     * If Redis is not configured, fail open.
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
     * Atomic INCR + EXPIRE.
     *
     * IMPORTANT:
     * - exec() returns an array of results
     * - For node-redis, each item is the raw value
     */
    const multiRes = await withTimeout(
      redis.multi().incr(key).expire(key, WINDOW_SECONDS).exec(),
      REDIS_TIMEOUT_MS
    );

    if (!Array.isArray(multiRes) || multiRes.length < 1) {
      next(); // fail open
      return;
    }

    const incrValue = multiRes[0];
    const count = typeof incrValue === "number" ? incrValue : Number(incrValue);

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
     * Enterprise rule:
     * Rate limiting must FAIL OPEN.
     */
    logger.warn(
      {
        err,
        route: req.originalUrl,
        method: req.method
      },
      "tierRateLimit failed (fail-open)"
    );

    next();
  }
}