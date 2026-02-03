import type { Request, Response, NextFunction } from "express";

const VALID_KEYS = new Set(
  (process.env.SECURELOGIC_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
);

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = req.header("x-securelogic-key");

  if (!key) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  if (!VALID_KEYS.has(key)) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  // 🔒 CONTRACT: attach validated identity
  (req as any).apiKey = key;

  next();
}