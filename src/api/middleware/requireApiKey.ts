çimport type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

type ApiKeySource = "authorization" | "x-api-key" | "x-securelogic-key" | "query" | "none";

function firstHeaderValue(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

export function extractApiKey(req: Request): { key: string | null; source: ApiKeySource } {
  // 1) Authorization: Bearer <key>
  const auth =
    req.get("authorization") ??
    firstHeaderValue(req.headers["authorization"]);

  if (typeof auth === "string" && auth.trim()) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return { key: m[1].trim(), source: "authorization" };
  }

  // 2) X-API-Key
  const xApiKey =
    req.get("x-api-key") ??
    firstHeaderValue(req.headers["x-api-key"]);

  if (typeof xApiKey === "string" && xApiKey.trim()) {
    return { key: xApiKey.trim(), source: "x-api-key" };
  }

  // 3) X-SecureLogic-Key
  const xSecureLogicKey =
    req.get("x-securelogic-key") ??
    firstHeaderValue(req.headers["x-securelogic-key"]);

  if (typeof xSecureLogicKey === "string" && xSecureLogicKey.trim()) {
    return { key: xSecureLogicKey.trim(), source: "x-securelogic-key" };
  }

  // 4) Last-resort query param (debug only)
  const q = (req.query as any)?.api_key;
  if (typeof q === "string" && q.trim()) {
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

  // SAFE debug: log only presence + header names when X-Debug-Trace is present
  const debugTrace = req.get("x-debug-trace");
  if (debugTrace) {
    const headerNames = Object.keys(req.headers || {}).sort();
    logger.warn(
      {
        debugTrace,
        source,
        hasAuthorization: Boolean(req.get("authorization") || req.headers["authorization"]),
        hasXApiKey: Boolean(req.get("x-api-key") || req.headers["x-api-key"]),
        hasXSecureLogicKey: Boolean(req.get("x-securelogic-key") || req.headers["x-securelogic-key"]),
        headerNames,
        path: req.originalUrl
      },
      "requireApiKey debug trace (sanitized)"
    );
  }

  if (!key) {
    logger.warn(
      {
        source,
        hasAuthorization: Boolean(req.get("authorization") || req.headers["authorization"]),
        hasXApiKey: Boolean(req.get("x-api-key") || req.headers["x-api-key"]),
        hasXSecureLogicKey: Boolean(req.get("x-securelogic-key") || req.headers["x-securelogic-key"]),
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
      { source, path: req.originalUrl },
      "requireApiKey: invalid api key"
    );
    res.status