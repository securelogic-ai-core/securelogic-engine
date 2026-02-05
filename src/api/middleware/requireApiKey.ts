import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

function loadAllowedKeys(): Set<string> {
  const raw = process.env.SECURELOGIC_API_KEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
  );
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key =
    req.get("x-securelogic-key") ??
    req.get("x-api-key") ??
    (req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null);

  if (!key) {
    logger.error({ headers: req.headers }, "requireApiKey: NO KEY EXTRACTED");
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowed = loadAllowedKeys();

  if (allowed.size === 0) {
    logger.error(
      { env: process.env.SECURELOGIC_API_KEYS },
      "SECURELOGIC_API_KEYS is empty or missing"
    );
    res.status(500).json({ error: "Server misconfigured: no API keys loaded" });
    return;
  }

  if (!allowed.has(key.trim())) {
    logger.error(
      { key, allowed: Array.from(allowed), source: "header" },
      "requireApiKey: KEY NOT ALLOWED"
    );
    res.status(403).json({ error: "API key invalid" });
    return;
  }

  (req as any).apiKey = key.trim();
  next();
}