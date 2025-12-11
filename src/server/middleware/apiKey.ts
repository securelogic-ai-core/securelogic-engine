import { Request, Response, NextFunction } from "express";

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-api-key"];
  if (!key || key !== "test123") {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}
