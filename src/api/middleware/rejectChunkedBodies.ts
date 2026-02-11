import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";
import { badRequest } from "../infra/httpResponses.js";

/**
 * rejectChunkedBodies (Enterprise-grade)
 *
 * PURPOSE:
 * Prevent bypass of early Content-Length enforcement via Transfer-Encoding: chunked.
 *
 * POLICY:
 * - For JSON body methods (POST/PUT/PATCH), require Content-Length.
 * - Exception: raw-body webhook routes that already enforce a strict limit.
 *
 * NOTE:
 * This is intentionally strict. If you need chunked uploads later,
 * add a dedicated endpoint with explicit streaming handling.
 */

export function rejectChunkedBodies(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  const isBodyMethod =
    method === "POST" || method === "PUT" || method === "PATCH";

  if (!isBodyMethod) {
    next();
    return;
  }

  if (req.originalUrl.startsWith("/webhooks/lemon")) {
    next();
    return;
  }

  const te = req.headers["transfer-encoding"];
  const hasChunked =
    (typeof te === "string" && te.toLowerCase().includes("chunked")) ||
    (Array.isArray(te) && te.some((v) => v.toLowerCase().includes("chunked")));

  const hasContentLength = typeof req.headers["content-length"] === "string";

  if (hasChunked && !hasContentLength) {
    logger.warn(
      {
        event: "blocked_chunked_body_without_content_length",
        method: req.method,
        path: req.originalUrl,
        transferEncoding: te
      },
      "Blocked request with chunked body (no Content-Length)"
    );

    badRequest(res, { reason: "content_length_required" });
    return;
  }

  next();
}
