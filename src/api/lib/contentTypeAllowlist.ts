/**
 * contentTypeAllowlist.ts — strict JSON Content-Type enforcement + its exempt
 * route list.
 *
 * The global guard rejects any body-bearing request whose Content-Type is not
 * application/json with a 415. A handful of routes legitimately receive other
 * content types (webhooks with raw bodies, multipart file uploads, SAML form
 * posts) and must be exempt.
 *
 * Both the predicate and the middleware live here, pure and tested, so the
 * exemption list cannot silently regress — omitting a multipart route 415s
 * every request to it before it reaches its handler. This is exactly what broke
 * Ask voice: /api/ask/transcribe was missing, so multipart audio uploads were
 * rejected at the gate (HTTP 415 `unsupported_media_type`).
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * Routes allowed to send non-JSON bodies. Keep this in sync with every
 * multipart / raw-body / form endpoint — a missing entry 415s the route.
 */
export function isContentTypeEnforcementExempt(originalUrl: string): boolean {
  return (
    originalUrl.startsWith("/webhooks/lemon") ||
    originalUrl.startsWith("/webhooks/email/resend") ||
    originalUrl.startsWith("/api/vendor-assessments/analyze-document") ||
    /^\/api\/vendor-assurance\/documents(\?|$)/.test(originalUrl) ||
    // Ask voice transcription receives multipart/form-data audio uploads.
    originalUrl.startsWith("/api/ask/transcribe") ||
    /^\/api\/sso\/[^/]+\/acs/.test(originalUrl)
  );
}

/**
 * STRICT CONTENT-TYPE ENFORCEMENT (ENTERPRISE). For POST/PUT/PATCH, require a
 * JSON Content-Type unless the route is exempt or sends no Content-Type at all.
 * Behaviour-preserving extraction of the former inline middleware in app.ts.
 */
export function enforceJsonContentType(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const isBodyMethod = method === "POST" || method === "PUT" || method === "PATCH";

  if (isContentTypeEnforcementExempt(req.originalUrl)) {
    next();
    return;
  }

  if (!isBodyMethod) {
    next();
    return;
  }

  const ct = req.headers["content-type"] ?? "";

  if (typeof ct !== "string" || ct.trim().length === 0) {
    next();
    return;
  }

  if (!ct.toLowerCase().startsWith("application/json")) {
    logger.warn(
      {
        event: "blocked_invalid_content_type",
        method: req.method,
        route: req.originalUrl,
        contentType: ct,
      },
      "Blocked request with invalid Content-Type"
    );
    res.status(415).json({ error: "unsupported_media_type" });
    return;
  }

  next();
}
