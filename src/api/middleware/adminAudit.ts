import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

/**
 * adminAudit (Enterprise-grade)
 *
 * Rules:
 * - Never log admin key or auth headers
 * - Always include requestId
 * - Logs only metadata (method/route/status/duration)
 * - Works in production safely
 */
export function adminAudit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;

    logger.info(
      {
        event: "admin_request",
        requestId: (req as any).requestId ?? req.get("x-request-id") ?? null,
        method: req.method,
        route: req.originalUrl,
        statusCode: res.statusCode,
        durationMs
      },
      "admin request"
    );
  });

  next();
}