import rateLimit from "express-rate-limit";
import { Request } from "express";

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,              // LOW on purpose to force 429
  keyGenerator: (req: Request): string => {
    return req.apiKey ?? "anonymous";
  },
  standardHeaders: true,
  legacyHeaders: false
});
