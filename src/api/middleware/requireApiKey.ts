import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

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

  /**
   * IMPORTANT (Option 2):
   * - We do NOT validate the key here.
   * - We only require that a key is PRESENT.
   * - Validation happens in resolveEntitlement (Redis source of truth).
   */
  (req as any).apiKey = key;
  next();
}