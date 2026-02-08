import type { Request, Response, NextFunction } from "express";
import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

type MeterRecord = {
  count: number;
  lastSeen: string;
};

const WINDOW_SECONDS = 60 * 60 * 24; // 24 hours rolling window
const REDIS_TIMEOUT_MS = 1200;

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

function safeIsoNow(): string {
  return new Date().toISOString();
}

/**
 * requestAudit (Enterprise-grade)
 *
 * RULES:
 * - Never write to local disk
 * - Redis-backed, atomic
 * - Never blocks request flow
 * - Fail-open (audit must not break the API)
 * - Never logs secrets
 */
export async function requestAudit(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    /**
     * If Redis isn't configured, fail-open.
     * Audit is not allowed to break the API.
     */
    if (!redisReady) {
      next();
      return;
    }

    const apiKey = (req as any).apiKey as string | undefined;

    if (!apiKey) {
      next();
      return;
    }

    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

    /**
     * Key design:
     * - audit:<apiKey>:<yyyy-mm-dd>
     * This prevents unbounded growth and keeps audit retrieval sane.
     */
    const day = safeIsoNow().slice(0, 10);
    const key = `audit:${apiKey}:${day}`;

    /**
     * Store:
     * - count = INCR
     * - lastSeen = ISO timestamp
     *
     * Use MULTI so it is atomic and 1 round trip.
     */
    const now = safeIsoNow();

    const resMulti = await withTimeout(
      redis.multi().incr(`${key}:count`).set(`${key}:lastSeen`, now).exec(),
      REDIS_TIMEOUT_MS
    );

    /**
     * Fail-open if Redis returns weird data.
     */
    if (!Array.isArray(resMulti) || resMulti.length < 2) {
      next();
      return;
    }

    const countRaw = resMulti[0];
    const count = typeof countRaw === "number" ? countRaw : Number(countRaw);

    if (!Number.isFinite(count)) {
      next();
      return;
    }

    /**
     * Expire keys (best effort)
     */
    try {
      await withTimeout(
        redis
          .multi()
          .expire(`${key}:count`, WINDOW_SECONDS)
          .expire(`${key}:lastSeen`, WINDOW_SECONDS)
          .exec(),
        REDIS_TIMEOUT_MS
      );
    } catch {
      // ignore expire failures
    }

    const meter: MeterRecord = {
      count,
      lastSeen: now
    };

    (req as any).meter = meter;
    next();
  } catch (err) {
    /**
     * Enterprise rule:
     * Audit must FAIL OPEN.
     */
    logger.warn(
      {
        err,
        route: req.originalUrl,
        method: req.method
      },
      "requestAudit failed (fail-open)"
    );

    next();
  }
}