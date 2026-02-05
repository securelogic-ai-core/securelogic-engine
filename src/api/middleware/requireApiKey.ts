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

function extractApiKey(req: Request): { key: string | null; source: string } {
  // Express lowercases all header keys in req.headers
  const h = req.headers;

  const securelogicKey = (h["x-securelogic-key"] as string | undefined)?.trim();
  if (securelogicKey) return { key: securelogicKey, source: "x-securelogic-key" };

  const apiKey = (h["x-api-key"] as string | undefined)?.trim();
  if (apiKey) return { key: apiKey, source: "x-api-key" };

  const auth = (h["authorization"] as string | undefined)?.trim();
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    const bearer = match?.[1]?.trim();
    if (bearer) return { key: bearer, source: "authorization_bearer" };
  }

  return { key: null, source: "none" };
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { key, source } = extractApiKey(req);

  // 🔥 CRITICAL DEBUG (Render / Cloudflare / Express header behavior)
  logger.warn(
    {
      source,
      extractedKeyPresent: Boolean(key),
      rawHeaders: req.headers
    },
    "requireApiKey: DEBUG HEADER VISIBILITY"
  );

  if (!key) {
    logger.error(
      { source, headers: req.headers },
      "requireApiKey: NO KEY EXTRACTED"
    );
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowed = loadAllowedKeys();

  if (allowed.size === 0) {
    logger.error(
      { env: process.env.SECURELOGIC_API_KEYS },
      "SECURELOGIC_API_KEYS is empty or missing"
    );
    res.status(500).json({ error: "server_misconfigured_no_api_keys" });
    return;
  }

  if (!allowed.has(key)) {
    logger.error(
      { key, allowed: Array.from(allowed), source },
      "requireApiKey: KEY NOT ALLOWED"
    );
    res.status(403).json({ error: "API key invalid" });
    return;
  }

  (req as any).apiKey = key;
  next();
}