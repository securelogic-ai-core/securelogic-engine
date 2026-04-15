/**
 * apiRateLimiter.ts — Configurable Redis-based rate limiters for API routes.
 *
 * Two factory functions:
 *   createApiKeyRateLimiter(limitPerMinute)
 *     — keyed on SHA-256 of the presented API key header.
 *       Does NOT require requireApiKey to have run first.
 *       Fails open when Redis is unavailable (rate limiting must never
 *       block the API).
 *
 *   createOrgRateLimiter(limitPerMinute)
 *     — keyed on organizationId from organizationContext.
 *       Requires attachOrganizationContext to have run first.
 *       Fails open when context is absent.
 *
 * Both limiters use the same atomic INCR+EXPIRE pattern as tierRateLimit.ts.
 */

import crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

const WINDOW_SECONDS = 60;
const REDIS_TIMEOUT_MS = 1200;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let id: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    id = setTimeout(() => reject(new Error(`redis_timeout_${ms}ms`)), ms);
    id.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(id));
}

async function checkLimit(
  redisKey: string,
  limitPerMinute: number,
  res: Response,
  next: NextFunction,
  context: Record<string, unknown>
): Promise<void> {
  if (!redisReady) {
    next();
    return;
  }

  try {
    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);
    const windowId = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `${redisKey}:${windowId}`;

    const multiRes = await withTimeout(
      redis.multi().incr(key).expire(key, WINDOW_SECONDS).exec(),
      REDIS_TIMEOUT_MS
    );

    if (!Array.isArray(multiRes) || multiRes.length < 1) {
      next();
      return;
    }

    const count = typeof multiRes[0] === "number" ? multiRes[0] : Number(multiRes[0]);

    if (!Number.isFinite(count)) {
      next();
      return;
    }

    if (count > limitPerMinute) {
      let ttl = WINDOW_SECONDS;
      try {
        const ttlRes = await withTimeout(redis.ttl(key), REDIS_TIMEOUT_MS);
        if (typeof ttlRes === "number" && ttlRes > 0) ttl = ttlRes;
      } catch {
        // ignore ttl failure
      }

      res.setHeader("Retry-After", String(ttl));
      res.status(429).json({
        error: "rate_limit_exceeded",
        limitPerMinute,
        retryAfterSeconds: ttl,
        ...context
      });
      return;
    }

    next();
  } catch (err) {
    logger.warn({ err, redisKey }, "apiRateLimiter: Redis error (fail-open)");
    next();
  }
}

/**
 * createApiKeyRateLimiter — rate-limit by hashed API key from request header.
 *
 * Reads X-Api-Key or Authorization: Bearer header directly — does NOT require
 * requireApiKey to have run. Fails open when no key header is present (the
 * request will be rejected downstream by requireApiKey).
 */
export function createApiKeyRateLimiter(limitPerMinute: number): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey =
      req.header("X-Api-Key") ||
      req.header("x-api-key") ||
      req.header("X-Securelogic-Key") ||
      req.header("Authorization")?.replace(/^Bearer\s+/i, "").trim();

    if (!rawKey) {
      // No key presented — fail open, requireApiKey will reject below.
      next();
      return;
    }

    const hashed = crypto.createHash("sha256").update(rawKey).digest("hex");
    const redisKey = `api:ratelimit:key:${hashed}`;

    await checkLimit(redisKey, limitPerMinute, res, next, { limitPerMinute });
  };
}

/**
 * createOrgRateLimiter — rate-limit by organization ID.
 *
 * Requires attachOrganizationContext to have run. Fails open when org context
 * is absent (e.g. for public routes that don't have org context).
 */
export function createOrgRateLimiter(
  limitPerMinute: number,
  scope: string
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = (req as any).organizationContext?.organizationId as string | undefined;

    if (!orgId) {
      next();
      return;
    }

    const redisKey = `api:ratelimit:org:${scope}:${orgId}`;
    await checkLimit(redisKey, limitPerMinute, res, next, { limitPerMinute, scope });
  };
}
