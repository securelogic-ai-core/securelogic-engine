import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * enforceAllowedMethods (Enterprise-grade)
 *
 * PURPOSE:
 * - Fail closed on unexpected HTTP methods (scanners, abuse clients, weird proxies).
 * - Prevent silent method fallthrough.
 * - Ensure consistent, clean 405 responses.
 *
 * POLICY:
 * - Allow only: GET, POST, PUT, DELETE
 * - Block: OPTIONS, TRACE, CONNECT, PATCH, etc.
 *
 * NOTE:
 * - OPTIONS is blocked intentionally because this API is not intended for browser usage.
 * - If you later expose a browser-facing API, you can whitelist OPTIONS on those routes only.
 */

const ALLOWED = new Set(["GET", "POST", "PUT", "DELETE"]);

export function enforceAllowedMethods(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();

  if (ALLOWED.has(method)) {
    next();
    return;
  }

  logger.warn(
    {
      event: "blocked_unexpected_http_method",
      method,
      path: req.originalUrl
    },
    "Blocked unexpected HTTP method"
  );

  res.status(405).json({
    error: "method_not_allowed",
    allowed: Array.from(ALLOWED),
    method
  });
}
