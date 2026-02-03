import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // ✅ Cloudflare + Express 5 SAFE header access
  const apiKey =
    req.get("x-api-key") ??
    req.get("X-API-Key") ??
    req.get("authorization")?.replace(/^Bearer\s+/i, "");

  logger.info(
    {
      receivedApiKey: apiKey ? "[present]" : "[missing]",
      rawHeaders: req.rawHeaders
    },
    "requireApiKey check"
  );

  if (!apiKey) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowedKeys = process.env.SECURELOGIC_API_KEYS
    ?.split(",")
    .map(k => k.trim());

  if (!allowedKeys?.includes(apiKey)) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  (req as any).apiKey = apiKey;
  next();
}