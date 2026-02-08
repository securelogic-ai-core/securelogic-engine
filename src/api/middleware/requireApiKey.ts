import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * Enterprise-grade API key extraction + validation.
 *
 * Rules:
 * - Accept only ONE key source per request (prevents ambiguity attacks)
 * - Never log key material
 * - Reject absurd lengths (header abuse / memory abuse)
 * - Enforce SecureLogic key format (sl_*)
 * - Fail closed
 */

const MAX_KEY_LENGTH = 128;
const MIN_KEY_LENGTH = 16;

type ApiKeySource = "bearer" | "x-api-key" | "x-securelogic-key";

function safeTrim(v: string | undefined | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;

  // Strict: Authorization: Bearer <token>
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  return safeTrim(m[1]);
}

function isSafeLength(key: string): boolean {
  return key.length >= MIN_KEY_LENGTH && key.length <= MAX_KEY_LENGTH;
}

/**
 * Enterprise key format.
 * - ASCII only
 * - prevents weird unicode, whitespace tricks, and header abuse
 */
function isValidApiKeyFormat(key: string): boolean {
  if (!key.startsWith("sl_")) return false;
  return /^sl_[a-z0-9]{16,64}$/i.test(key);
}

function extractApiKey(req: Request): {
  key: string | null;
  source: ApiKeySource | null;
  sourcesSeen: number;
} {
  const authHeader = safeTrim(req.get("authorization"));
  const bearer = extractBearer(authHeader);

  const fromApiKey = safeTrim(req.get("x-api-key"));
  const fromSecurelogic = safeTrim(req.get("x-securelogic-key"));

  const candidates: Array<{ source: ApiKeySource; value: string }> = [];

  if (typeof bearer === "string" && bearer.length > 0) {
    candidates.push({ source: "bearer", value: bearer });
  }

  if (typeof fromApiKey === "string" && fromApiKey.length > 0) {
    candidates.push({ source: "x-api-key", value: fromApiKey });
  }

  if (typeof fromSecurelogic === "string" && fromSecurelogic.length > 0) {
    candidates.push({ source: "x-securelogic-key", value: fromSecurelogic });
  }

  if (candidates.length === 0) {
    return { key: null, source: null, sourcesSeen: 0 };
  }

  /**
   * Enterprise rule:
   * If multiple are provided, reject.
   * Prevents confusion attacks and request smuggling ambiguity.
   */
  if (candidates.length > 1) {
    return { key: null, source: null, sourcesSeen: candidates.length };
  }

  const chosen = candidates[0];

  // Defensive (should be impossible now)
  if (!chosen) {
    return { key: null, source: null, sourcesSeen: 0 };
  }

  return {
    key: chosen.value,
    source: chosen.source,
    sourcesSeen: 1
  };
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const extracted = extractApiKey(req);

  /**
   * Multiple sources is a hard reject.
   */
  if (extracted.sourcesSeen > 1) {
    logger.warn(
      {
        event: "api_key_rejected_multiple_sources",
        route: req.originalUrl,
        method: req.method,
        requestId: req.get("x-request-id") ?? null,
        sourcesSeen: extracted.sourcesSeen
      },
      "requireApiKey rejected request: multiple api key sources"
    );

    res.status(400).json({ error: "multiple_api_key_sources" });
    return;
  }

  const key = extracted.key;

  if (!key) {
    logger.warn(
      {
        event: "api_key_missing",
        route: req.originalUrl,
        method: req.method,
        requestId: req.get("x-request-id") ?? null,
        authHeaderPresent: Boolean(req.get("authorization")),
        xApiKeyPresent: Boolean(req.get("x-api-key")),
        xSecurelogicKeyPresent: Boolean(req.get("x-securelogic-key"))
      },
      "requireApiKey: missing api key"
    );

    res.status(401).json({ error: "api_key_required" });
    return;
  }

  /**
   * Block absurd lengths (header abuse)
   */
  if (!isSafeLength(key)) {
    logger.warn(
      {
        event: "api_key_invalid_length",
        route: req.originalUrl,
        method: req.method,
        requestId: req.get("x-request-id") ?? null,
        keyLength: key.length,
        source: extracted.source
      },
      "requireApiKey: invalid api key length"
    );

    res.status(401).json({ error: "api_key_invalid" });
    return;
  }

  /**
   * Block malformed keys early (cheap rejection before Redis)
   */
  if (!isValidApiKeyFormat(key)) {
    logger.warn(
      {
        event: "api_key_invalid_format",
        route: req.originalUrl,
        method: req.method,
        requestId: req.get("x-request-id") ?? null,
        source: extracted.source
      },
      "requireApiKey: api key failed format validation"
    );

    res.status(401).json({ error: "api_key_invalid" });
    return;
  }

  /**
   * IMPORTANT:
   * We do NOT validate entitlement/subscription here.
   * That happens in resolveEntitlement (Redis is source of truth).
   */
  (req as any).apiKey = key;

  /**
   * Useful for auditing without leaking secrets.
   */
  (req as any).apiKeySource = extracted.source;

  next();
}