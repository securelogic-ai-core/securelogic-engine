import type { Request, Response, NextFunction } from "express";

const ADMIN_KEY = process.env.SECURELOGIC_ADMIN_KEY;

export function requireAdminToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const token = header.slice("Bearer ".length).trim();

  if (!ADMIN_KEY || token !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}
