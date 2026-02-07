import type { Request, Response, NextFunction } from "express";
import { logger } from "../infra/logger.js";

export function adminAudit(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;

    logger.info(
      {
        event: "admin_request",
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