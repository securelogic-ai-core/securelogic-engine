import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

function extractApiKey(req: Request): { key: string | null; source: "authorization" | "x-api-key" | "none" } {
  const auth = req.header("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return { key: m[1].trim(), source: "authorization" };
  }

  const x = req.header("x-api-key");
  if (x) return { key: x.trim(), source: "x-api-key" };

  return { key: null, source: "none" };
}

function loadAllowedKeys(): Set<string> {
  const raw = process.env.SECURELOGIC_API_KEYS ?? "";
  const keys = raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  return new Set(keys);
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const { key, source } = extractApiKey(req);

  // SAFE debug: do not log secrets, only presence + which headers exist
  const hasAuthHeader = Boolean(req.header("authorization"));
  const hasXApiKeyHeader = Boolean(req.header("x-api-key"));

  if (!key) {
    logger.warn(
      {
        source,
        hasAuthHeader,
        hasXApiKeyHeader,
        path: req.originalUrl
      },
      "requireApiKey: missing api key"
    );
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowed = loadAllowedKeys();

  if (allowed.size === 0) {
    logger.error(
      { path: req.originalUrl },
      "requireApiKey: SECURELOGIC_API_KEYS missing/empty"
    );
    res.status(503).json({ error: "auth_misconfigured" });
    return;
  }

  if (!allowed.has(key)) {
    logger.warn(
      {
        source,
        hasAuthHeader,
        hasXApiKeyHeader,
        path: req.originalUrl
      },
      "requireApiKey: invalid api key"
    );
    res.status(403).json({ error: "API key invalid" });
    return;
  }

  (req as any).apiKey = key;
  next();
}