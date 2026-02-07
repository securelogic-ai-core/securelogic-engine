import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

const WINDOW_SECONDS = 60;
const REDIS_TIMEOUT_MS = 1200;

// Admin is powerful. Don’t let it be spammable.
const ADMIN_LIMIT_PER_MINUTE = 60;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`redis_timeout_after_${ms}ms`));
      }, ms).unref?.() ??
        setTimeout(() => reject(new Error(`redis_timeout_after_${ms}ms`)), ms);
    })
  ]);
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function extractExecResult<T = unknown>(raw: unknown): T | null {
  /**
   * node-redis can return:
   *  - [result1, result2, ...]
   *  - [[err, result1], [err, result2], ...]  (older patterns)
   *
   * We only need the first command result (INCR).
   */
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const first = raw[0];

  // Shape: [[null, 1], [null, 60]]
  if (Array.isArray(first) && first.length >= 2) {
    return first[1] as T;
  }

  // Shape: [1, true] or [1, "OK"]
  return first as T;
}

export async function adminRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // PROD-SAFE: if Redis is not configured, fail open
    if (!redisReady) {
      next();
      return;
    }

    const rawAdminKey = req.get("x-admin-key") ?? "missing_admin_key";

    // Never store raw admin keys in Redis keyspace
    const adminKeyHash = sha256(rawAdminKey);

    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

    const windowId = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `rate_admin:${adminKeyHash}:${windowId}`;

    const execRes = await withTimeout(
      redis.multi().incr(key).expire(key, WINDOW_SECONDS).exec(),
      REDIS_TIMEOUT_MS
    );

    const incrRes = extractExecResult<number>(execRes);
    const count = Number(incrRes);

    if (!Number.isFinite(count)) {
      next();
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
          route: req.originalUrl,
          method: req.method,
          adminLimitPerMinute: ADMIN_LIMIT_PER_MINUTE,
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
    // PROD-SAFE: fail open
    logger.warn({ err }, "adminRateLimit failed (fail-open)");
    next();
  }
}