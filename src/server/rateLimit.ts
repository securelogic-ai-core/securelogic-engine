import rateLimit from "express-rate-limit";

export const verifierLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30
});
