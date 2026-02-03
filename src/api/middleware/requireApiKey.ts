import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  /**
   * IMPORTANT:
   * - Header names are ALWAYS lower-cased in Node
   * - Render + Cloudflare do NOT alter custom headers
   */

  const apiKey =
    (req.headers["x-api-key"] as string | undefined) ??
    (req.headers["X-API-KEY"] as string | undefined);

  logger.debug(
    {
      apiKeyPresent: Boolean(apiKey),
      envKeysPresent: Boolean(process.env.SECURELOGIC_API_KEYS),
    },
    "API key middleware check"
  );

  if (!apiKey) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowedKeys = process.env.SECURELOGIC_API_KEYS
    ?.split(",")
    .map(k => k.trim())
    .filter(Boolean);

  if (!allowedKeys || allowedKeys.length === 0) {
    logger.error("SECURELOGIC_API_KEYS is empty or malformed");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  if (!allowedKeys.includes(apiKey)) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  // Attach for downstream middleware
  (req as any).apiKey = apiKey;

  next();
}