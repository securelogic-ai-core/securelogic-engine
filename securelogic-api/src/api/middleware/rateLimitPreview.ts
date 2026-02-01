import { Request, Response, NextFunction } from "express";

export function rateLimitPreview(
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.log("[RATE_LIMIT] HIT");

  return res.status(429).json({
    error: "RATE LIMIT ACTIVE"
  });
}
