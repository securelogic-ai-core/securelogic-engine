import { Request, Response, NextFunction } from "express";
import { findTrialKey, isExpired } from "./trialKeyStore.js";

export function requireTrialKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const apiKey = req.header("x-api-key");

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const record = findTrialKey(apiKey);

  if (!record) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  if (isExpired(record)) {
    return res.status(403).json({
      error: "Trial expired",
      action: "upgrade_required"
    });
  }

  (req as any).accessTier = record.tier;
  next();
}
