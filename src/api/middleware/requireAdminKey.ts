import type { Request, Response, NextFunction } from "express";

export function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expected = process.env.SECURELOGIC_ADMIN_KEY;

  if (!expected) {
    res.status(500).json({ error: "SECURELOGIC_ADMIN_KEY not configured" });
    return;
  }

  const got = req.header("X-Admin-Key");

  if (!got || got !== expected) {
    res.status(403).json({ error: "Invalid admin key" });
    return;
  }

  next();
}
