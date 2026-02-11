import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";
import { badRequest } from "../infra/httpResponses.js";

/**
 * rejectOversizedBody (Enterprise-grade)
 *
 * PURPOSE:
 * Fail-closed protection against:
 * - request body amplification
 * - memory churn from malicious clients
 * - large payload attacks (pre-JSON-parse)
 *
 * NOTE:
 * express.json({ limit }) will eventually block large bodies,
 * but this middleware fails earlier based on Content-Length,
 * preventing unnecessary work and memory churn.
 *
 * IMPORTANT:
 * This is a guardrail, not a replacement for express.json limit.
 */

const MAX_BODY_BYTES = 256 * 1024; // 256kb

export function rejectOversizedBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();

  // Only enforce on methods that typically carry a body
  const isBodyMethod =
    method === "POST" || method === "PUT" || method === "PATCH";

  if (!isBodyMethod) {
    next();
    return;
  }

  // Allow raw body webhook route (it has its own strict limit)
  if (req.originalUrl.startsWith("/webhooks/lemon")) {
    next();
    return;
  }

  const raw = req.headers["content-length"];

  if (raw === undefined) {
    next();
    return;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    logger.warn(
      {
        event: "blocked_invalid_content_length",
        method: req.method,
        path: req.originalUrl,
        contentLength: raw
      },
      "Blocked request with invalid Content-Length header"
    );

    badRequest(res, { reason: "invalid_content_length" });
    return;
  }

  if (parsed > MAX_BODY_BYTES) {
    logger.warn(
      {
        event: "blocked_oversized_body",
        method: req.method,
        path: req.originalUrl,
        contentLength: parsed,
        maxBytes: MAX_BODY_BYTES
      },
      "Blocked request with oversized body"
    );

    badRequest(res, {
      reason: "request_body_too_large",
      maxBytes: MAX_BODY_BYTES
    });
    return;
  }

  next();
}
