/**
 * jwt.ts — Minimal HS256 JWT implementation using Node.js crypto.
 *
 * No external dependency. Signs and verifies JWTs using HMAC-SHA256
 * with the JWT_SECRET environment variable.
 *
 * Token lifetime: 7 days. Intended for customer-facing portal sessions.
 */

import crypto from "crypto";

export interface JwtPayload {
  /** User UUID */
  sub: string;
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
  type: "mfa_challenge";
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
      JSON.stringify({ sub, org, role, se: sessionEpoch, iat: now, exp: now + EXPIRY_SECONDS }),
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
    Buffer.from(JSON.stringify({ sub, org, type: "mfa_challenge", iat: now, exp: now + 300 }), "utf8")
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

    if (payload.type !== "mfa_challenge") return null;
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
 * Verify a JWT and return its payload, or null if invalid/expired.
 * Returns null (never throws) on any validation failure.
 */
export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, sigB64] = parts as [string, string, string];
    const signing = `${headerB64}.${bodyB64}`;

    const expectedSig = b64url(
      crypto.createHmac("sha256", getSecret()).update(signing).digest()
    );

    // Timing-safe comparison prevents timing attacks on the signature
    if (
      !crypto.timingSafeEqual(
        Buffer.from(sigB64,      "base64url"),
        Buffer.from(expectedSig, "base64url")
      )
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(bodyB64, "base64url").toString("utf8")
    ) as JwtPayload;

    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    // Backfill role for tokens issued before Sprint 7
    if (!payload.role) payload.role = "admin";

    return payload;
  } catch {
    return null;
  }
}
