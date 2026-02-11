import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * rejectInvalidJson (Enterprise-grade)
 *
 * PURPOSE:
 * - Catch invalid JSON body parse errors thrown by express.json()
 * - Fail closed with a clean 400 response
 * - Prevent noisy stack traces / inconsistent error handling
 *
 * IMPORTANT:
 * - This MUST be registered immediately AFTER express.json()
 * - express.json throws a SyntaxError with "type" = "entity.parse.failed"
 */

function isBodyParserJsonError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const anyErr = err as Record<string, unknown>;

  /**
   * body-parser typically sets:
   * - err.type = "entity.parse.failed"
   * - err.status = 400
   */
  const type = anyErr.type;
  const status = anyErr.status;

  return type === "entity.parse.failed" || status === 400;
}

export function rejectInvalidJson(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isBodyParserJsonError(err)) {
    next(err);
    return;
  }

  logger.warn(
    {
      event: "blocked_invalid_json",
      method: req.method,
      path: req.originalUrl
    },
    "Blocked request with invalid JSON body"
  );

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(400).json({ error: "bad_request" });
}