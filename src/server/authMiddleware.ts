import type { Request, Response, NextFunction } from "express";
import { TIER_LIMITS } from "../product/billing/tierLimits";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.header("x-api-key");
  if (!key) return res.status(401).json({ error: "API_KEY_REQUIRED" });

  // Placeholder: replace with DB lookup
  const tier = "FREE";
  (req as any).tier = tier;
  (req as any).limits = TIER_LIMITS[tier];
  next();
}
