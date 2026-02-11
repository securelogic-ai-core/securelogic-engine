import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";
import { badRequest } from "../infra/httpResponses.js";

/**
 * rejectInvalidMethodOverride (Enterprise-grade)
 *
 * PURPOSE:
 * Prevent HTTP method override attacks.
 *
 * Threat model:
 * Some stacks allow overriding methods using:
 * - X-HTTP-Method-Override header
 * - X-Method-Override header
 * - _method query param
 * - _method body param
 *
 * This is dangerous because:
 * - It can bypass route protections
 * - It can confuse logging/auditing
 * - It can break assumptions in middleware chains
 *
 * SecureLogic policy:
 * - We do NOT allow method overrides anywhere.
 * - If a client sends override signals, fail closed with 400.
 */

const OVERRIDE_HEADERS = [
  "x-http-method-override",
  "x-method-override"
] as const;

export function rejectInvalidMethodOverride(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  for (const header of OVERRIDE_HEADERS) {
    const v = req.headers[header];

    if (typeof v === "string" && v.trim().length > 0) {
      logger.warn(
        {
          event: "blocked_method_override_header",
          header,
          value: v,
          method: req.method,
          path: req.originalUrl
        },
        "Blocked request attempting HTTP method override via header"
      );

      badRequest(res, { reason: "method_override_not_allowed" });
      return;
    }

    if (Array.isArray(v) && v.length > 0) {
      logger.warn(
        {
          event: "blocked_method_override_header",
          header,
          value: v.join(","),
          method: req.method,
          path: req.originalUrl
        },
        "Blocked request attempting HTTP method override via header"
      );

      badRequest(res, { reason: "method_override_not_allowed" });
      return;
    }
  }

  // Block query-based override (?_method=DELETE)
  const q = req.query as Record<string, unknown>;
  const qMethod = q?._method;

  if (typeof qMethod === "string" && qMethod.trim().length > 0) {
    logger.warn(
      {
        event: "blocked_method_override_query",
        method: req.method,
        path: req.originalUrl,
        override: qMethod
      },
      "Blocked request attempting HTTP method override via query"
    );

    badRequest(res, { reason: "method_override_not_allowed" });
    return;
  }

  next();
}
