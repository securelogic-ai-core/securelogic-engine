import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * Canonical API key enforcement middleware
 * - Single source of truth: x-api-key
 * - Establishes request identity for downstream middleware
 * - NO other middleware may read headers
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 🔒 Canonical header (LOCKED)
  const apiKey = req.get("x-api-key");

  if (!apiKey) {
    logger.warn(
      {
        path: req.originalUrl,
        method: req.method
      },
      "API key missing"
    );

    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowedKeys = process.env.SECURELOGIC_API_KEYS
    ?.split(",")
    .map(k => k.trim())
    .filter(Boolean);

  if (!allowedKeys || !allowedKeys.includes(apiKey)) {
    logger.warn(
      {
        path: req.originalUrl,
        method: req.method
      },
      "Invalid API key"
    );

    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  // 🔒 Phase 5: canonical request identity
  (req as any).identity = {
    apiKey
  };

  next();
}