import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis.js";

/**
 * Phase 6 — Runtime Hard Gate
 * Fail requests if Redis is unavailable.
 * This prevents serving paid intelligence without metering state.
 */
export function requireRedis(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!redis.isOpen || redis.isReady === false) {
    res.status(503).json({
      error: "redis_unavailable",
      dependency: "redis"
    });
    return;
  }

  next();
}
