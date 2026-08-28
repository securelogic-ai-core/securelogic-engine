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
  /**
   * Token-type discriminator (SEC-TOKEN-1, issue #821).
   *
   * OPTIONAL on the type for exactly one reason: session tokens minted before
   * this shipped carry no `type` claim and stay valid for up to their 7-day
   * lifetime. `verifyJwt` therefore accepts absent-or-"session" and rejects
   * every other value, which is what closes the MFA-challenge crossover
   * without invalidating live sessions. Once the pre-fix window has elapsed
   * this becomes required — see the note on verifyJwt.
   */
  type?: "session";
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
      JSON.stringify({
        sub,
        org,
        role,
        se: sessionEpoch,
        // SEC-TOKEN-1: every session token states what it is. verifyJwt
        // accepts only this value (or its absence, for pre-fix tokens);
        // signMfaChallenge mints "mfa_challenge" and is now rejected.
        type: "session",
        iat: now,
        exp: now + EXPIRY_SECONDS
      }),
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
 * Verify a SESSION JWT and return its payload, or null if invalid/expired.
 * Returns null (never throws) on any validation failure.
 *
 * SEC-TOKEN-1 — THE TOKEN-TYPE INVARIANT (issue #821)
 * ---------------------------------------------------
 * Every token this service mints is signed with the SAME key. A valid
 * signature therefore proves origin, NOT purpose. Before this guard,
 * `verifyJwt` asserted only "signed by us and not expired", which made an
 * `mfa_challenge` token — minted by signMfaChallenge for a user who has NOT
 * yet passed the second factor — a structurally valid session payload. The
 * `role` backfill below then handed it `admin`.
 *
 * WHY THE GUARD LIVES HERE AND NOT IN THE CALLERS
 * -----------------------------------------------
 * It was previously argued that the missing-`se` rejection in requireAuth and
 * requireApiKey already blocked the crossover, because signMfaChallenge mints
 * no `se`. That is true of those two callers and is NOT true of the set:
 * `requireConsent.ts:49` also calls verifyJwt and consumes `payload.sub` as an
 * authenticated identity with no epoch check and no type check. A defence that
 * has to be re-implemented correctly in every present and future caller is not
 * a defence — one caller already lacks it. The invariant belongs to the
 * verifier, which is the single place that can state it once.
 *
 * WHY ABSENCE IS ACCEPTED (AND FOR HOW LONG)
 * ------------------------------------------
 * Session tokens minted before this shipped carry no `type` claim and remain
 * valid for up to EXPIRY_SECONDS (7 days). Rejecting absence would have logged
 * out every live session, so the rule is "absent, or exactly 'session'" —
 * which rejects `mfa_challenge` (the actual defect) with zero session
 * breakage. This is deliberately the WEAKER of the two available rules and
 * should be tightened to require `type === "session"` once 7 days have passed
 * since deployment; the regression suite carries a test that documents the
 * pre-fix acceptance so tightening it is a one-line, one-test change.
 *
 * Note the ordering: the type check runs BEFORE the role backfill, so a
 * foreign token can never be handed a default role on its way to rejection.
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

    // SEC-TOKEN-1: a signature proves origin, not purpose. Accept only a token
    // that says it is a session (or says nothing, for the pre-fix window) and
    // reject every other minted type — today that is `mfa_challenge`, and any
    // type added later is rejected by default rather than by remembering to.
    const claimedType = (payload as { type?: unknown }).type;
    if (claimedType !== undefined && claimedType !== "session") return null;

    // Backfill role for tokens issued before Sprint 7. Runs AFTER the type
    // guard so a foreign token is never granted 'admin' en route to rejection.
    if (!payload.role) payload.role = "admin";

    return payload;
  } catch {
    return null;
  }
}
