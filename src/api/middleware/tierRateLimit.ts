import type { Request, Response, NextFunction } from "express";
import { redis } from "../infra/redis.js";

type Tier = "free" | "paid" | "admin";

const LIMITS: Record<Tier, number> = {
  free: 50,
  paid: 5000,
  admin: Number.POSITIVE_INFINITY
};

const WINDOW_SECONDS = 60;

export async function tierRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tier = (req as any).entitlement as Tier | undefined;
  const apiKey = (req as any).apiKey as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "API key required (tierRateLimit)" });
    return;
  }

  if (!tier || !["free", "paid", "admin"].includes(tier)) {
    res.status(500).json({ error: "Missing entitlement tier" });
    return;
  }

  if (tier === "admin") {
    next();
    return;
  }

  const key = `rate:${tier}:${apiKey}`;

  try {
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    if (count > LIMITS[tier]) {
      res.status(429).json({
        error: "Rate limit exceeded",
        tier,
        limit: LIMITS[tier],
        windowSeconds: WINDOW_SECONDS
      });
      return;
    }

    next();
  } catch (err) {
    // Fail open for rate limit (don’t take down the API if Redis is flaky)
    console.error("⚠️ tierRateLimit Redis unavailable — allowing request:", err);
    next();
  }
}