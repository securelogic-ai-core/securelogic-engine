import { Request, Response, NextFunction } from "express";
import { recordUsage } from "../telemetry/usage";

export function telemetry(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const apiKey = req.header("x-api-key") || "anonymous";

  res.on("finish", () => {
    recordUsage({
      apiKey,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString()
    });
  });

  next();
}
