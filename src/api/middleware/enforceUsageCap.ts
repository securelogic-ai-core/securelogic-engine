import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const LIMITS: Record<Tier, number> = {
  free: 50,
  paid: 10_000,
  admin: Number.POSITIVE_INFINITY
};

const WINDOW_SECONDS = 60 * 60 * 24;

export async function enforceUsageCap(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const identity = (req as any).identity;
    const tier = ((req as any).entitlement as Tier) ?? "free";

    if (tier === "admin") {
      next();
      return;
    }

    const apiKey = identity?.apiKey;
    if (!apiKey) {
      res.status(401).json({ error: "Missing API key" });
      return;
    }

    const key = `usage:${tier}:${apiKey}`;
    const used = await redis.incr(key);

    if (used === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (used > LIMITS[tier]) {
      res.status(402).json({
        error: "Usage cap exceeded",
        tier,
        limit: LIMITS[tier]
      });
      return;
    }

    next();
  } catch {
    res.status(500).json({ error: "Usage enforcement failed" });
  }
}