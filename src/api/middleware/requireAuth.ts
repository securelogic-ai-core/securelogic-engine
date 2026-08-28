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
import { verifyJwtDetailed, SESSION_BLOCKED_STATUSES, type JwtPayload } from "../lib/jwt.js";
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

  const token    = header.slice(7).trim();
  const verified = verifyJwtDetailed(token);

  if (!verified.ok) {
    // SEC-TOKEN-1: a validly-signed session minted before the purpose claim
    // existed is answered with `session_invalidated` — a code the app tier's
    // session probe already treats as "sign in again" — so the user is sent
    // to login rather than left holding a session every data call rejects.
    // Everything else (bad signature, expired, another purpose presented as
    // a session) stays the opaque invalid-token 401.
    if (verified.reason === "legacy_untyped") {
      res.status(401).json({
        error: "session_invalidated",
        detail: "This session predates a security update. Please sign in again."
      });
      return;
    }
    res.status(401).json({ error: "invalid_or_expired_token" });
    return;
  }
  const payload = verified.payload;

  // SEC-JWT-EPOCH: a session token MUST carry the epoch it was minted under.
  // Absence is invalid session state, NOT a compatibility fallback — tokens
  // signed before this shipped have no `se` claim and must re-authenticate.
  //
  // Checked BEFORE the users lookup, deliberately: this branch is a pure
  // function of the token, so it cannot be turned into an accept by the
  // fail-open DB handler below. Missing-epoch and DB-error are distinct
  // failure modes and must not be able to mask one another.
  if (typeof payload.se !== "number") {
    res.status(401).json({
      error: "session_epoch_missing",
      detail: "This session predates a security update. Please sign in again."
    });
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
      session_epoch: number;
    }>(
      `SELECT password_changed_at, status, role, session_epoch FROM users WHERE id = $1 LIMIT 1`,
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

    // Deterministic invalidation: integer equality, no clock. This SUBSUMES the
    // legacy iat-vs-password_changed_at comparison kept below — any token that
    // one would reject also has a stale epoch — and additionally closes its
    // sub-second bypass, where a token minted at T+0.2s survived a password
    // change at T+0.5s because floor(T.5) === T made `iat < boundary` false.
    if (payload.se !== row.session_epoch) {
      res.status(401).json({ error: "session_invalidated", detail: "This session is no longer valid. Please sign in again." });
      return;
    }

    // Legacy timestamp check, retained unchanged. Redundant against the epoch
    // check above and kept only so this package neither weakens nor rewrites
    // existing semantics; it is the belt to the epoch's braces.
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
