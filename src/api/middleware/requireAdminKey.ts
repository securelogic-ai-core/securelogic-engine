import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);

  if (aBuf.length !== bBuf.length) return false;

  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.SECURELOGIC_ADMIN_KEY;

  if (!expected) {
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  const got = req.get("x-admin-key")?.trim() ?? "";

  if (!got) {
    res.status(401).json({ error: "admin_key_required" });
    return;
  }

  if (!safeEqual(got, expected)) {
    res.status(403).json({ error: "admin_key_invalid" });
    return;
  }

  next();
}