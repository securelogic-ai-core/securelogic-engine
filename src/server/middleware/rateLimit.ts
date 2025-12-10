import rateLimit from "express-rate-limit";
import { Request } from "express";

/**
 * Simple in-memory tier map.
 * Later this can come from DB or env without changing the limiter.
 */
const API_KEY_TIERS: Record<string, number> = {
  test123: 5,     // free
  pro123: 60,     // pro
  ent123: 1000    // enterprise
};

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute

  max: (req: Request): number => {
    const key = req.apiKey ?? "anonymous";
    return API_KEY_TIERS[key] ?? 5; // default to free tier
  },

  keyGenerator: (req: Request): string => {
    return req.apiKey ?? "anonymous";
  },

  standardHeaders: true,
  legacyHeaders: false
});
