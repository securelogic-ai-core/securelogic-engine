/**
 * requireAuth.ts — JWT middleware for customer-facing auth routes.
 *
 * Reads the JWT from the Authorization: Bearer <token> header,
 * verifies it with verifyJwt(), and attaches the payload to req.jwtPayload.
 *
 * Used exclusively by /api/auth/* endpoints.
 * Data routes use requireApiKey (which also accepts JWTs via bridge logic).
 */

import type { Request, Response, NextFunction } from "express";
import { verifyJwt, type JwtPayload } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token   = header.slice(7).trim();
  const payload = verifyJwt(token);

  if (!payload) {
    res.status(401).json({ error: "invalid_or_expired_token" });
    return;
  }

  req.jwtPayload = payload;
  next();
}
