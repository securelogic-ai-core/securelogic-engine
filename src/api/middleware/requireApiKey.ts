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
  return v;
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key =
    getHeader(req, "x-securelogic-key") ??
    getHeader(req, "x-api-key") ??
    (() => {
      const auth = getHeader(req, "authorization");
      if (!auth) return null;
      const m = auth.match(/^Bearer\s+(.+)$/i);
      return m?.[1]?.trim() ?? null;
    })();

  logger.info(
    {
      extractedKeyPresent: Boolean(key),
      keySource: key
        ? getHeader(req, "x-securelogic-key")
          ? "x-securelogic-key"
          : getHeader(req, "x-api-key")
            ? "x-api-key"
            : "authorization"
        : "none",
      headersSeen: Object.keys(req.headers),
      xSecurelogicKeyRaw: getHeader(req, "x-securelogic-key"),
      xApiKeyRaw: getHeader(req, "x-api-key"),
      authorizationRaw: getHeader(req, "authorization")
    },
    "requireApiKey: header inspection"
  );

  if (!key) {
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

  const trimmed = key.trim();

  if (!allowed.has(trimmed)) {
    logger.warn(
      { key: trimmed, allowed: Array.from(allowed) },
      "requireApiKey: KEY NOT ALLOWED"
    );
    res.status(403).json({ error: "API key invalid" });
    return;
  }

  (req as any).apiKey = trimmed;
  next();
}