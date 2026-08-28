/**
 * jwt.ts — Minimal HS256 JWT implementation using Node.js crypto.
 *
 * No external dependency. Signs and verifies JWTs using HMAC-SHA256
 * with the JWT_SECRET environment variable.
 *
 * Token lifetime: 7 days. Intended for customer-facing portal sessions.
 */

import crypto from "crypto";

/**
 * SEC-TOKEN-1 (issue #821): every token this module mints with JWT_SECRET
 * carries an explicit purpose in `type`, and every verifier requires ITS OWN
 * purpose. The session verifier accepts only `"session"`; the MFA verifier
 * accepts only `"mfa_challenge"`. A token is never usable for a purpose it
 * was not minted for, regardless of which other claims it happens to carry.
 * Never derive purpose from the presence/absence of another claim (`se`,
 * `role`, …) — that is exactly the incidental coupling #821 describes.
 */
export const SESSION_TOKEN_TYPE = "session" as const;
export const MFA_CHALLENGE_TOKEN_TYPE = "mfa_challenge" as const;

export interface JwtPayload {
  /** User UUID */
  sub: string;
  /** Token purpose. Always `"session"` on a verified session payload. */
  type: typeof SESSION_TOKEN_TYPE;
  /** Organization UUID */
  org: string;
  /** User role — 'admin' | 'analyst' | 'viewer' */
  role: string;
  /**
   * Session epoch (users.session_epoch) this token was minted under.
   *
   * Deliberately OPTIONAL on the type, because a token minted before
   * SEC-JWT-EPOCH genuinely has no such claim and verifyJwt must still be able
   * to decode it in order to REJECT it. Absence is invalid session state, not
   * a compatibility fallback — the middlewares treat a missing `se` as an
   * immediate 401 (see requireAuth.ts / requireApiKey.ts). Never default it.
   */
  se?: number;
  /** Issued-at (Unix seconds) */
  iat: number;
  /** Expiry (Unix seconds) */
  exp: number;
}

export interface MfaChallengePayload {
  sub: string;
  org: string;
  type: typeof MFA_CHALLENGE_TOKEN_TYPE;
  iat: number;
  exp: number;
}

const EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function getSecret(): string {
  const s = process.env.JWT_SECRET ?? "";
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
}

/**
 * Sign a JWT for the given user + org + role + session epoch.
 * Throws if JWT_SECRET is not set.
 *
 * `sessionEpoch` MUST be the caller's freshly-read users.session_epoch. The
 * default of 0 exists only so the signature stays compatible for the MFA and
 * test paths that mint against a known-zero epoch; passing a stale value
 * silently mints a session that the middleware will reject on the next
 * request, which is the safe direction but a bug worth catching in review.
 */
export function signJwt(
  sub: string,
  org: string,
  role: string = "admin",
  sessionEpoch: number = 0
): string {
  const header = b64url(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8")
  );
  const now  = Math.floor(Date.now() / 1000);
  const body = b64url(
    Buffer.from(
      JSON.stringify({ sub, org, role, se: sessionEpoch, type: SESSION_TOKEN_TYPE, iat: now, exp: now + EXPIRY_SECONDS }),
      "utf8"
    )
  );

  const signing = `${header}.${body}`;
  const sig     = b64url(
    crypto.createHmac("sha256", getSecret()).update(signing).digest()
  );

  return `${signing}.${sig}`;
}

/** Sign a 5-minute MFA challenge token. Not a full session — only grants access to MFA verification. */
export function signMfaChallenge(sub: string, org: string): string {
  const header = b64url(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8")
  );
  const now  = Math.floor(Date.now() / 1000);
  const body = b64url(
    Buffer.from(JSON.stringify({ sub, org, type: MFA_CHALLENGE_TOKEN_TYPE, iat: now, exp: now + 300 }), "utf8")
  );
  const signing = `${header}.${body}`;
  const sig     = b64url(
    crypto.createHmac("sha256", getSecret()).update(signing).digest()
  );
  return `${signing}.${sig}`;
}

/** Verify an MFA challenge token. Returns null on any failure, including wrong type. */
export function verifyMfaChallenge(token: string): MfaChallengePayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, sigB64] = parts as [string, string, string];
    const signing = `${headerB64}.${bodyB64}`;

    const expectedSig = b64url(
      crypto.createHmac("sha256", getSecret()).update(signing).digest()
    );

    if (
      !crypto.timingSafeEqual(
        Buffer.from(sigB64,      "base64url"),
        Buffer.from(expectedSig, "base64url")
      )
    ) return null;

    const payload = JSON.parse(
      Buffer.from(bodyB64, "base64url").toString("utf8")
    ) as MfaChallengePayload;

    if (payload.type !== MFA_CHALLENGE_TOKEN_TYPE) return null;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * User statuses that terminate a session immediately, regardless of the
 * token's remaining lifetime: member removal ('inactive') and the GDPR
 * deletion lifecycle. Both JWT verification paths (requireAuth and the
 * requireApiKey bridge) consult this on every request — a status flip or
 * a hard-deleted row must not keep working until natural JWT expiry.
 */
export const SESSION_BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  "inactive",
  "pending_deletion",
  "deleted",
]);

/**
 * Why a verified session token is rejected. Distinguished so the middlewares
 * can answer a LEGACY session (validly signed, minted before SEC-TOKEN-1, no
 * `type`) with a 401 code the app tier already treats as "sign in again",
 * while every other purpose stays an opaque invalid-token 401.
 *
 *   malformed / bad_signature / expired — not a token we minted, or dead
 *   legacy_untyped — OUR signature, no `type` claim at all: a pre-#821 session
 *   wrong_type     — OUR signature, a `type` that is not "session": a token
 *                    minted for another purpose (MFA challenge, …) presented
 *                    as a session. Never legitimate; worth auditing.
 *   missing_role   — typed session without a usable role (never minted; the
 *                    old admin backfill is gone — see #821 step 3)
 */
export type JwtVerifyFailure =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "legacy_untyped"
  | "wrong_type"
  | "missing_role";

export type JwtVerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: JwtVerifyFailure };

/**
 * Verify a SESSION JWT with a structured outcome. Never throws.
 *
 * Order matters: signature and expiry are checked before any claim is read,
 * so the type/role reasons are only ever reported for tokens WE signed — a
 * forged or tampered body can never learn which claim it got wrong.
 */
export function verifyJwtDetailed(token: string): JwtVerifyResult {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, reason: "malformed" };

    const [headerB64, bodyB64, sigB64] = parts as [string, string, string];
    const signing = `${headerB64}.${bodyB64}`;

    // The algorithm is pinned to HS256 here; the header's `alg` is never
    // consulted, so alg=none / RS256 confusion cannot bypass the HMAC.
    const expectedSig = b64url(
      crypto.createHmac("sha256", getSecret()).update(signing).digest()
    );
    const presented = Buffer.from(sigB64, "base64url");
    const expected  = Buffer.from(expectedSig, "base64url");

    // Timing-safe comparison prevents timing attacks on the signature
    if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
      return { ok: false, reason: "bad_signature" };
    }

    const payload = JSON.parse(
      Buffer.from(bodyB64, "base64url").toString("utf8")
    ) as Partial<JwtPayload> & { type?: unknown };

    if (payload === null || typeof payload !== "object") return { ok: false, reason: "malformed" };
    if (typeof payload.exp !== "number") return { ok: false, reason: "malformed" };
    if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };

    // SEC-TOKEN-1: purpose is REQUIRED and must be exactly "session".
    // Absence is a pre-#821 session (reject; the user signs in again).
    // Any other value is a different purpose presented as a session.
    if (!("type" in payload) || payload.type === undefined) return { ok: false, reason: "legacy_untyped" };
    if (payload.type !== SESSION_TOKEN_TYPE) return { ok: false, reason: "wrong_type" };

    // No role backfill. signJwt has always stamped a role; a typed session
    // without one was never minted by us. Defaulting to the MOST privileged
    // role was the wrong direction (#821 step 3).
    if (typeof payload.role !== "string" || payload.role.length === 0) return { ok: false, reason: "missing_role" };
    if (typeof payload.sub !== "string" || typeof payload.org !== "string") return { ok: false, reason: "malformed" };

    return { ok: true, payload: payload as JwtPayload };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/**
 * Verify a SESSION JWT and return its payload, or null if invalid/expired/
 * not a session token. Returns null (never throws) on any validation failure.
 *
 * Accepts ONLY tokens minted by signJwt (type "session"). MFA challenges and
 * any other purpose minted with the same secret are rejected here, not
 * incidentally downstream.
 */
export function verifyJwt(token: string): JwtPayload | null {
  const r = verifyJwtDetailed(token);
  return r.ok ? r.payload : null;
}
