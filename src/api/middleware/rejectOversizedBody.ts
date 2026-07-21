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

const MAX_BODY_BYTES = 256 * 1024; // 256kb — JSON / urlencoded ceiling

// Multipart uploads (Remediation Evidence, vendor-assurance documents, asset
// imports, voice transcription, etc.) carry binary FILE bytes and enforce their
// OWN precise per-route size limit via multer — the largest today is 25 MB
// (MAX_EVIDENCE_FILE_BYTES / MAX_BYTE_SIZE). The 256 KB guard above is a
// pre-parse amplification backstop tuned for JSON bodies; applying it to
// multipart rejects EVERY legitimate file upload > 256 KB (e.g. a normal
// screenshot PNG) with `request_body_too_large` before the request ever reaches
// its route or multer. So multipart gets a higher global backstop, set safely
// above the largest per-route limit (25 MB) with headroom for the multipart
// envelope (boundaries + the accompanying text fields); each upload route still
// enforces its exact cap and content validation. Keep this >= the largest
// multer `limits.fileSize` in src/api/routes/*.
const MAX_MULTIPART_BODY_BYTES = 32 * 1024 * 1024; // 32 MB

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

  // Multipart file uploads get the higher backstop; everything else the strict
  // 256 KB JSON ceiling. The per-route multer limit is the real cap.
  const contentType = req.headers["content-type"];
  const isMultipart =
    typeof contentType === "string" &&
    contentType.toLowerCase().includes("multipart/form-data");
  const maxBytes = isMultipart ? MAX_MULTIPART_BODY_BYTES : MAX_BODY_BYTES;

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

  if (parsed > maxBytes) {
    logger.warn(
      {
        event: "blocked_oversized_body",
        method: req.method,
        path: req.originalUrl,
        contentLength: parsed,
        maxBytes,
        multipart: isMultipart
      },
      "Blocked request with oversized body"
    );

    badRequest(res, {
      reason: "request_body_too_large",
      maxBytes
    });
    return;
  }

  next();
}
