import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * rejectUnexpectedOptions (Enterprise-grade)
 *
 * PURPOSE:
 * - Stop scanners and abuse clients from probing OPTIONS routes.
 * - Fail closed on unexpected OPTIONS requests.
 *
 * POLICY:
 * - Allow OPTIONS only for explicit CORS preflight cases.
 * - Otherwise return 405 Method Not Allowed.
 *
 * NOTE:
 * Express will auto-handle OPTIONS in some cases.
 * We intentionally enforce a consistent policy here.
 */

function isCorsPreflight(req: Request): boolean {
  if (req.method.toUpperCase() !== "OPTIONS") return false;

  const origin = req.headers.origin;
  const acrm = req.headers["access-control-request-method"];

  return typeof origin === "string" && typeof acrm === "string";
}

export function rejectUnexpectedOptions(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method.toUpperCase() !== "OPTIONS") {
    next();
    return;
  }

  if (isCorsPreflight(req)) {
    // Let cors() handle it.
    next();
    return;
  }

  logger.warn(
    {
      event: "blocked_unexpected_options",
      path: req.originalUrl,
      ip: req.ip
    },
    "Blocked unexpected OPTIONS request"
  );

  res.status(405).json({
    error: "method_not_allowed",
    allowed: ["GET", "POST", "PUT", "DELETE"],
    method: "OPTIONS"
  });
}
