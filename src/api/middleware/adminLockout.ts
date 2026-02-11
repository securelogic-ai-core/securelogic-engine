import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

/**
 * adminLockout (Enterprise-grade)
 *
 * PURPOSE:
 * - Prevent brute-force guessing of X-Admin-Key.
 * - Lock out abusive IPs after repeated failures.
 *
 * POLICY:
 * - After MAX_FAILURES, block the IP for LOCKOUT_SECONDS.
 * - Uses Redis so lockout is shared across instances.
 *
 * IMPORTANT:
 * - This MUST run BEFORE requireAdminKey
 * - This is designed to fail closed:
 *   If Redis is not ready, admin routes are unavailable.
 */

const MAX_FAILURES = 5;
const FAILURE_WINDOW_SECONDS = 10 * 60; // 10 minutes
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

function getClientIp(req: Request): string {
  // Express will use X-Forwarded-For correctly because server.ts sets trust proxy = 1
  return req.ip || "unknown";
}

function fail(res: Response, status: number, body: Record<string, unknown>) {
  res.status(status).json(body);
}

export async function adminLockout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!redisReady) {
      logger.error(
        { event: "admin_lockout_redis_not_ready", path: req.originalUrl },
        "Admin lockout cannot run (Redis not ready) - failing closed"
      );
      fail(res, 503, { error: "service_unavailable" });
      return;
    }

    const redis = await ensureRedisConnected();

    const ip = getClientIp(req);
    const lockKey = `admin:lockout:${ip}`;
    const failKey = `admin:failures:${ip}`;

    const isLocked = await redis.get(lockKey);

    if (isLocked) {
      logger.warn(
        {
          event: "admin_lockout_blocked",
          ip,
          path: req.originalUrl
        },
        "Blocked admin request (IP locked out)"
      );

      fail(res, 429, {
        error: "too_many_requests",
        reason: "admin_lockout"
      });
      return;
    }

    // Attach helpers for requireAdminKey to use
    (req as any).adminLockout = {
      ip,
      lockKey,
      failKey
    };

    next();
  } catch (err) {
    logger.error(
      { event: "admin_lockout_failed", err },
      "Admin lockout middleware failed - failing closed"
    );

    fail(res, 503, { error: "service_unavailable" });
  }
}

/**
 * Call this when admin auth FAILS.
 */
export async function recordAdminAuthFailure(req: Request): Promise<void> {
  try {
    if (!redisReady) return;

    const redis = await ensureRedisConnected();

    const ctx = (req as any).adminLockout as
      | { ip: string; lockKey: string; failKey: string }
      | undefined;

    const ip = ctx?.ip ?? getClientIp(req);
    const lockKey = ctx?.lockKey ?? `admin:lockout:${ip}`;
    const failKey = ctx?.failKey ?? `admin:failures:${ip}`;

    const failures = await redis.incr(failKey);

    // Ensure failure window exists
    if (failures === 1) {
      await redis.expire(failKey, FAILURE_WINDOW_SECONDS);
    }

    if (failures >= MAX_FAILURES) {
      await redis.set(lockKey, "1", { EX: LOCKOUT_SECONDS });

      logger.warn(
        {
          event: "admin_lockout_triggered",
          ip,
          failures,
          lockoutSeconds: LOCKOUT_SECONDS
        },
        "Admin IP locked out due to repeated failures"
      );
    } else {
      logger.warn(
        {
          event: "admin_auth_failed",
          ip,
          failures,
          maxFailures: MAX_FAILURES
        },
        "Admin auth failed (recorded)"
      );
    }
  } catch (err) {
    logger.error(
      { event: "admin_record_failure_failed", err },
      "Failed to record admin auth failure"
    );
  }
}

/**
 * Call this when admin auth SUCCEEDS.
 * This prevents a user from being permanently near-lockout.
 */
export async function clearAdminAuthFailures(req: Request): Promise<void> {
  try {
    if (!redisReady) return;

    const redis = await ensureRedisConnected();

    const ctx = (req as any).adminLockout as
      | { ip: string; lockKey: string; failKey: string }
      | undefined;

    const ip = ctx?.ip ?? getClientIp(req);
    const failKey = ctx?.failKey ?? `admin:failures:${ip}`;

    await redis.del(failKey);
  } catch (err) {
    logger.error(
      { event: "admin_clear_failures_failed", err },
      "Failed to clear admin auth failures"
    );
  }
}
