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

function getHeader(req: Request, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return String(v);
}

function extractApiKey(req: Request): string | null {
  const fromSecurelogic = getHeader(req, "x-securelogic-key");
  if (fromSecurelogic?.trim()) return fromSecurelogic.trim();

  const fromApiKey = getHeader(req, "x-api-key");
  if (fromApiKey?.trim()) return fromApiKey.trim();

  const auth = getHeader(req, "authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (bearer?.trim()) return bearer.trim();

  return null;
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = extractApiKey(req);

  if (!key) {
    logger.warn(
      {
        headersSeen: Object.keys(req.headers)
      },
      "requireApiKey: missing api key"
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
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  if (!allowed.has(key)) {
    logger.warn({ key }, "requireApiKey: KEY NOT ALLOWED");
    res.status(403).json({ error: "API key invalid" });
    return;
  }

  (req as any).apiKey = key;
  next();
}
