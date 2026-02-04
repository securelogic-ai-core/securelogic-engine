import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

type ApiKeySource =
  | "authorization"
  | "x-api-key"
  | "x-securelogic-key"
  | "query"
  | "none";

function extractApiKey(
  req: Request
): { key: string | null; source: ApiKeySource } {
  const auth = req.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) {
      return { key: m[1].trim(), source: "authorization" };
    }
  }

  const xApiKey = req.get("x-api-key");
  if (xApiKey) {
    return { key: xApiKey.trim(), source: "x-api-key" };
  }

  const xSecureLogicKey = req.get("x-securelogic-key");
  if (xSecureLogicKey) {
    return { key: xSecureLogicKey.trim(), source: "x-securelogic-key" };
  }

  const q = req.query?.api_key;
  if (typeof q === "string" && q.trim()) {
    return { key: q.trim(), source: "query" };
  }

  return { key: null, source: "none" };
}

function loadAllowedKeys(): Set<string> {
  const raw = process.env.SECURELOGIC_API_KEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map(k => k.trim())
      .filter(Boolean)
  );
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 🔥 HARD PROOF — THIS MUST PRINT OR THE PROCESS IS WRONG
  console.error("🔥 HEADERS SEEN BY requireApiKey:", req.headers);

  const { key, source } = extractApiKey(req);

  if (!key) {
    logger.error(
      { headers: req.headers, source },
      "requireApiKey: NO KEY EXTRACTED"
    );
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowed = loadAllowedKeys();

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