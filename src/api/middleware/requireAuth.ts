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
import { pg } from "../infra/postgres.js";

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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

  // Reject tokens issued before the user's most recent password change.
  // Fail open on DB error — a transient failure must not lock out all users.
  try {
    const result = await pg.query<{ password_changed_at: Date | null }>(
      `SELECT password_changed_at FROM users WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );
    const changedAt = result.rows[0]?.password_changed_at ?? null;
    if (changedAt !== null && payload.iat < Math.floor(new Date(changedAt).getTime() / 1000)) {
      res.status(401).json({ error: "session_invalidated", detail: "Password was changed. Please sign in again." });
      return;
    }
  } catch {
    // fail open
  }

  req.jwtPayload = payload;
  next();
}
