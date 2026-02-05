import type { Request, Response, NextFunction } from "express";
import { redisReady } from "../infra/redis.js";

export function requireRedis(req: Request, res: Response, next: NextFunction) {
  if (!redisReady) {
    return res.status(503).json({ error: "Redis not configured" });
  }
  next();
}
