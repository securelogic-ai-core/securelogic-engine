import rateLimit from "express-rate-limit";
import { Request } from "express";
import { TIER_LIMITS } from "../config/tiers";

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req: Request) => {
    const tier = req.apiTier ?? "free";
    return TIER_LIMITS[tier];
  },
  keyGenerator: (req: Request) => {
    return req.apiKey ?? req.ip ?? "anonymous";
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      ok: false,
      code: "RATE_LIMITED",
      message: "Tier rate limit exceeded"
    });
  }
});
