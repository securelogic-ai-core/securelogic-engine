import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * rejectInvalidMethod (Enterprise-grade)
 *
 * PURPOSE:
 * Block dangerous / unsupported HTTP methods globally.
 *
 * WHY THIS MATTERS:
 * - CONNECT can be abused for proxy tunneling attempts.
 * - TRACE can enable cross-site tracing (XST) in misconfigured stacks.
 * - Unknown methods can bypass assumptions in middleware chains.
 *
 * RULE:
 * Allow only the methods we explicitly support.
 */

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

export function rejectInvalidMethod(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const method = (req.method ?? "").toUpperCase();

  if (ALLOWED_METHODS.has(method)) {
    next();
    return;
  }

  logger.warn(
    {
      event: "blocked_invalid_method",
      method,
      path: req.originalUrl
    },
    "Blocked request with invalid HTTP method"
  );

  res.status(405).json({ error: "method_not_allowed" });
}
