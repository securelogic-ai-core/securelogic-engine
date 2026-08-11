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
import { verifyJwt, SESSION_BLOCKED_STATUSES, type JwtPayload } from "../lib/jwt.js";
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

  // Live-session enforcement against the users row. Fail open on DB
  // error — a transient failure must not lock out all users — but a
  // SUCCESSFUL read is authoritative: removed members, deletion-lifecycle
  // statuses, hard-deleted rows, and pre-password-change tokens all
  // terminate here rather than at natural JWT expiry.
  try {
    const result = await pg.query<{
      password_changed_at: Date | null;
      status: string;
      role: string;
    }>(
      `SELECT password_changed_at, status, role FROM users WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );
    const row = result.rows[0] ?? null;

    if (row === null || SESSION_BLOCKED_STATUSES.has(row.status)) {
      res.status(401).json({
        error: "account_inactive",
        detail: "This account no longer has access. Contact your administrator."
      });
      return;
    }

    if (row.password_changed_at !== null && payload.iat < Math.floor(new Date(row.password_changed_at).getTime() / 1000)) {
      res.status(401).json({ error: "session_invalidated", detail: "Password was changed. Please sign in again." });
      return;
    }

    // Role changes take effect immediately: downstream reads the current
    // DB role, not the up-to-7-day-old claim baked into the token.
    req.jwtPayload = { ...payload, role: row.role };
    next();
    return;
  } catch {
    // fail open
  }

  req.jwtPayload = payload;
  next();
}
