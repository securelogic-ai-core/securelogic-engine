import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const LIMITS: Record<Tier, number> = {
  free: 50,
  paid: 5000,
  admin: Number.POSITIVE_INFINITY
};

const WINDOW_SECONDS = 60; // per minute

function getApiKey(req: Request): string {
  // 🔒 Phase 6.2: canonical identity ONLY
  return ((req as any).identity?.apiKey as string | undefined) ?? "";
}

export async function tierRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tier = (req as any).entitlement as Tier;

  if (tier === "admin") {
    next();
    return;
  }

  const apiKey = getApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const key = `rate:${tier}:${apiKey}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  if (count > LIMITS[tier]) {
    res.status(429).json({
      error: "Rate limit exceeded",
      tier,
      limit: LIMITS[tier]
    });
    return;
  }

  next();
}