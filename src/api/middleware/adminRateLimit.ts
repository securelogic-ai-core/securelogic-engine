import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

const WINDOW_SECONDS = 60;
const REDIS_TIMEOUT_MS = 1200;

// Admin is powerful. Don’t let it be spammable.
const ADMIN_LIMIT_PER_MINUTE = 60;

/**
 * Promise timeout wrapper.
 * If Redis stalls, we FAIL CLOSED for /admin routes.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`redis_timeout_after_${ms}ms`));
    }, ms);

    timeoutId.unref?.();
  });

  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * node-redis exec() returns:
 * - (modern) [res1, res2]
 * - (older) [[null, res1], [null, res2]]
 *
 * We only care about the INCR result (first command).
 */
function extractIncrResult(raw: unknown): number | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const first = raw[0];

  // Older shape: [[null, 1], [null, "OK"]]
  if (Array.isArray(first) && first.length >= 2) {
    const v = first[1];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Modern shape: [1, true] or [1, "OK"]
  const n = typeof first === "number" ? first : Number(first);
  return Number.isFinite(n) ? n : null;
}

function failClosed(res: Response): void {
  res.status(503).json({ error: "service_unavailable" });
}

export async function adminRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    /**
     * ENTERPRISE RULE:
     * Admin rate limiting MUST be enforced.
     * If Redis is not ready, fail closed.
     */
    if (!redisReady) {
      logger.error(
        {
          event: "admin_rate_limit_redis_not_ready",
          route: req.originalUrl,
          method: req.method
        },
        "adminRateLimit: redis not ready (fail-closed)"
      );

      failClosed(res);
      return;
    }

    /**
     * requireAdminKey already runs BEFORE this middleware.
     * But we still avoid assuming it.
     */
    const rawAdminKey = (req.get("x-admin-key") ?? "").trim();

    /**
     * Never store raw admin keys in Redis keyspace.
     */
    const adminKeyHash = sha256(rawAdminKey || "missing_admin_key");

    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

    const windowId = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `rate_admin:${adminKeyHash}:${windowId}`;

    /**
     * Atomic INCR + EXPIRE
     */
    const execRes = await withTimeout(
      redis.multi().incr(key).expire(key, WINDOW_SECONDS).exec(),
      REDIS_TIMEOUT_MS
    );

    const count = extractIncrResult(execRes);

    /**
     * ENTERPRISE RULE:
     * If Redis returns unexpected results, fail closed.
     */
    if (count === null) {
      logger.error(
        {
          event: "admin_rate_limit_unexpected_redis_response",
          route: req.originalUrl,
          method: req.method
        },
        "adminRateLimit: could not parse Redis response (fail-closed)"
      );

      failClosed(res);
      return;
    }

    if (count > ADMIN_LIMIT_PER_MINUTE) {
      let ttl = WINDOW_SECONDS;

      try {
        const ttlRes = await withTimeout(redis.ttl(key), REDIS_TIMEOUT_MS);
        if (typeof ttlRes === "number" && ttlRes > 0) ttl = ttlRes;
      } catch {
        // ignore ttl failures
      }

      logger.warn(
        {
          event: "admin_rate_limit_exceeded",
          route: req.originalUrl,
          method: req.method,
          limitPerMinute: ADMIN_LIMIT_PER_MINUTE,
          retryAfterSeconds: ttl
        },
        "adminRateLimit: rate limit exceeded"
      );

      res.setHeader("Retry-After", String(ttl));
      res.status(429).json({
        error: "admin_rate_limit_exceeded",
        limitPerMinute: ADMIN_LIMIT_PER_MINUTE,
        retryAfterSeconds: ttl
      });
      return;
    }

    next();
  } catch (err) {
    /**
     * ENTERPRISE RULE:
     * Fail closed for /admin.
     */
    logger.error(
      {
        err,
        route: req.originalUrl,
        method: req.method,
        event: "admin_rate_limit_failed"
      },
      "adminRateLimit failed (fail-closed)"
    );

    failClosed(res);
  }
}
