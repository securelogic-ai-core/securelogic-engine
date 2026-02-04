import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

type ApiKeySource =
  | "authorization"
  | "x-api-key"
  | "x-securelogic-key"
  | "query"
  | "none";

function extractHeader(req: Request, name: string): string | null {
  // Express normalizes header lookup; req.get() is the correct API
  const v = req.get(name);
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

export function extractApiKey(req: Request): { key: string | null; source: ApiKeySource } {
  // 1) Authorization: Bearer <key>
  const auth = extractHeader(req, "authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return { key: m[1].trim(), source: "authorization" };
  }

  // 2) X-API-Key
  const xApiKey = extractHeader(req, "x-api-key");
  if (xApiKey) return { key: xApiKey, source: "x-api-key" };

  // 3) X-SecureLogic-Key
  // NOTE: header name is case-insensitive; curl can send X-SecureLogic-Key
  const xSecureLogicKey = extractHeader(req, "x-securelogic-key");
  if (xSecureLogicKey) return { key: xSecureLogicKey, source: "x-securelogic-key" };

  // 4) Query param fallback (debug-only)
  const q = (req.query as Record<string, unknown> | undefined)?.api_key;
  if (typeof q === "string" && q.trim().length > 0) {
    return { key: q.trim(), source: "query" };
  }

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

  const hasAuthHeader = Boolean(extractHeader(req, "authorization"));
  const hasXApiKeyHeader = Boolean(extractHeader(req, "x-api-key"));
  const hasXSecureLogicKeyHeader = Boolean(extractHeader(req, "x-securelogic-key"));

  if (!key) {
    logger.warn(
      {
        source,
        hasAuthHeader,
        hasXApiKeyHeader,
        hasXSecureLogicKeyHeader,
        path: req.originalUrl
      },
      "requireApiKey: missing api key"
    );
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowed = loadAllowedKeys();

  if (allowed.size === 0) {
    logger.error({ path: req.originalUrl }, "requireApiKey: SECURELOGIC_API_KEYS missing/empty");
    res.status(503).json({ error: "auth_misconfigured" });
    return;
  }

  if (!allowed.has(key)) {
    logger.warn(
      {
        source,
        hasAuthHeader,
        hasXApiKeyHeader,
        hasXSecureLogicKeyHeader,
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
