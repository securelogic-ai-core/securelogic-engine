import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";
import { uriTooLong } from "../infra/httpResponses.js";

/**
 * rejectOversizedUrl (Enterprise-grade)
 *
 * PURPOSE:
 * Hard block absurdly long URLs to prevent:
 * - log amplification
 * - reverse proxy edge abuse
 * - pathological router behavior
 * - memory churn from malicious requests
 *
 * NOTES:
 * - Uses byte length (not string length) to avoid unicode tricks.
 * - Fail-closed security middleware.
 */

const DEFAULT_MAX_URL_BYTES = 2048;

function safeUrl(v: unknown): string {
  if (typeof v !== "string") return "";
  return v;
}

function getMaxBytes(): number {
  const raw = (process.env.SECURELOGIC_MAX_URL_BYTES ?? "").trim();
  const n = Number(raw);

  if (!raw) return DEFAULT_MAX_URL_BYTES;
  if (!Number.isFinite(n)) return DEFAULT_MAX_URL_BYTES;
  if (n < 256) return 256;
  if (n > 16384) return 16384;

  return Math.floor(n);
}

export function rejectOversizedUrl(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const url = safeUrl(req.originalUrl || req.url);
  const size = Buffer.byteLength(url, "utf8");

  const maxBytes = getMaxBytes();

  if (size <= maxBytes) {
    next();
    return;
  }

  logger.warn(
    {
      event: "blocked_oversized_url",
      method: req.method,
      route: req.path,
      urlBytes: size,
      maxBytes
    },
    "Blocked request with oversized URL"
  );

  uriTooLong(res, {
    urlBytes: size,
    maxBytes
  });
}