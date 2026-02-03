import type { Request, Response, NextFunction } from "express";

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const apiKey =
    req.headers["x-api-key"] as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  const allowedKeys = process.env.SECURELOGIC_API_KEYS
    ?.split(",")
    .map(k => k.trim());

  if (!allowedKeys?.includes(apiKey)) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  (req as any).apiKey = apiKey;
  next();
}