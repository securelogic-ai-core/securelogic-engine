import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * Global error handler (FAIL CLOSED)
 * - Last middleware in chain
 * - Never leaks stack traces
 * - Logs with request correlation
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.headers["x-request-id"];

  logger.error(
    {
      err,
      requestId,
      path: req.originalUrl,
      method: req.method
    },
    "Unhandled request error"
  );

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error: "internal_server_error",
    requestId
  });
}
