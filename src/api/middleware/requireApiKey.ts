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

function extractApiKey(req: Request): string | null {
  // 1) PRIMARY: Authorization: Bearer <key>
  const auth = req.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (bearer) return bearer;

  // 2) Fallback: x-api-key
  const fromApiKey = req.get("x-api-key");
  if (fromApiKey?.trim()) return fromApiKey.trim();

  // 3) Legacy fallback: x-securelogic-key
  const fromSecurelogic = req.get("x-securelogic-key");
  if (fromSecurelogic?.trim()) return fromSecurelogic.trim();

  return null;
}

function redactKey(key: string): string {
  if (key.length <= 8) return "********";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
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
        headersSeen: Object.keys(req.headers),
        authHeaderPresent: Boolean(req.get("authorization")),
        xApiKeyPresent: Boolean(req.get("x-api-key")),
        xSecurelogicKeyPresent: Boolean(req.get("x-securelogic-key"))
      },
      "requireApiKey: missing api key"
    );

    res.status(401).json({ error: "api_key_required" });
    return;
  }

  const allowed = loadAllowedKeys();

  // DEV MODE: allow any key (for local testing ONLY)
  if (process.env.NODE_ENV === "development") {
    (req as any).apiKey = key;
    next();
    return;
  }

  // PROD MODE: MUST have explicit allowlist
  if (allowed.size === 0) {
    logger.error(
      { envPresent: Boolean(process.env.SECURELOGIC_API_KEYS) },
      "SECURELOGIC_API_KEYS is empty or missing"
    );
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  if (!allowed.has(key)) {
    logger.warn({ key: redactKey(key) }, "requireApiKey: KEY NOT ALLOWED");
    res.status(403).json({ error: "api_key_invalid" });
    return;
  }

  (req as any).apiKey = key;
  next();
}