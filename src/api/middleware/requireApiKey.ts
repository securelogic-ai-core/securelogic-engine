import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * Canonical API key enforcement middleware
 * - Uses Authorization: Bearer <key>
 * - Cloudflare / Render safe
 * - FAIL CLOSED
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn(
      { path: req.originalUrl, method: req.method },
      "Authorization header missing or malformed"
    );

    res.status(401).json({ error: "API key required" });
    return;
  }

  const apiKey = authHeader.replace("Bearer ", "").trim();

  const allowedKeys = process.env.SECURELOGIC_API_KEYS
    ?.split(",")
    .map(k => k.trim())
    .filter(Boolean);

  if (!allowedKeys || !allowedKeys.includes(apiKey)) {
    logger.warn(
      { path: req.originalUrl, method: req.method },
      "Invalid API key"
    );

    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  (req as any).identity = { apiKey };
  next();
}