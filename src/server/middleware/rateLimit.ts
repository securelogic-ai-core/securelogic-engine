import rateLimit from "express-rate-limit";
import { Request } from "express";
import { recordBlocked } from "../telemetry/usage";

const API_KEY_TIERS: Record<string, number> = {
  test123: 5,
  pro123: 60,
  ent123: 1000
};

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,

  max: (req: Request): number => {
    const key = req.apiKey ?? "anonymous";
    return API_KEY_TIERS[key] ?? 5;
  },

  keyGenerator: (req: Request): string => {
    return req.apiKey ?? "anonymous";
  },

  handler: (req, res) => {
    const key = req.apiKey ?? "anonymous";
    recordBlocked(key);
    res.status(429).send("Too many requests, please try again later.");
  },

  standardHeaders: true,
  legacyHeaders: false
});
