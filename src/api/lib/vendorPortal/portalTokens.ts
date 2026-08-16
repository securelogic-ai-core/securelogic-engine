/**
 * portalTokens.ts — token minting and hashing for the external vendor portal.
 *
 * PURE. No I/O, no DB, no clock except an injectable `now`. That matters: this
 * is the module whose correctness the entire external trust boundary rests on,
 * and a pure module can be exhaustively tested without a database.
 *
 * ── The model, copied deliberately from a shipped precedent ────────────────
 *
 * src/api/lib/dataExportDownloadToken.ts already establishes exactly this shape
 * for GDPR export links, and it has been in production since June:
 *
 *   - the RAW token is crypto.randomBytes(32) — 256 bits — hex encoded;
 *   - only a plain SHA-256 hash is ever persisted;
 *   - lookup is BY that hash against a unique index, so a database read never
 *     yields a usable token.
 *
 * Intentionally NOT an HMAC: there is no server-side secret in the scheme.
 * Security rests on the entropy, the unique-hash lookup and a bounded expiry —
 * the same posture as an API key. Adding a secret would create a new rotation
 * problem without closing an attack.
 *
 * ── Two token types, different lifetimes, different jobs ───────────────────
 *
 *   INVITE   long-lived capability, delivered by email, exchanged for a session.
 *   SESSION  short-lived authenticated session, delivered as an httpOnly cookie.
 *
 * The exchange exists so a weeks-long secret never lives in a URL, where it
 * would persist in browser history, in Referer headers to any third-party asset,
 * and in every access log between the vendor and us.
 */

import crypto from "crypto";

/**
 * How long an invitation stays usable. Matched to a realistic questionnaire
 * turnaround: long enough that a vendor does not need a re-send for an ordinary
 * review cycle, short enough that a leaked email is not indefinitely valuable.
 */
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Session lifetimes. BOTH bounds are enforced:
 *   - idle:     a session goes stale if unused, so an abandoned browser on a
 *               shared machine does not stay open;
 *   - absolute: a session dies regardless of activity, so polling cannot keep
 *               one alive forever.
 * Either alone leaves a real hole.
 */
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** 256-bit random token, hex encoded. Same generator as customerApiKeys. */
export function generatePortalToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Plain SHA-256 hex — exactly what is stored in *_token_hash. */
export function hashPortalToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Hash a user agent for fingerprinting. The raw UA is not stored: it is a
 * fingerprinting surface with no investigative value beyond "did it change",
 * and it can carry identifying detail about a vendor's device estate.
 */
export function hashUserAgent(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  return crypto.createHash("sha256").update(userAgent).digest("hex");
}

export type MintedInvite = {
  /** Raw token — goes into the email and nowhere else. Never persisted. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function mintInviteToken(now: Date = new Date()): MintedInvite {
  const token = generatePortalToken();
  return {
    token,
    tokenHash: hashPortalToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  };
}

export type MintedSession = {
  /** Raw token — goes into the httpOnly cookie and nowhere else. */
  token: string;
  tokenHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

export function mintSessionToken(now: Date = new Date()): MintedSession {
  const token = generatePortalToken();
  return {
    token,
    tokenHash: hashPortalToken(token),
    idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
  };
}

/** Slide the idle window, never past the absolute bound. */
export function slideIdleWindow(absoluteExpiresAt: Date, now: Date = new Date()): Date {
  const slid = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
  return slid > absoluteExpiresAt ? absoluteExpiresAt : slid;
}

// ── Validity ────────────────────────────────────────────────────────────────

/**
 * Why a credential was rejected.
 *
 * `expired` is reported distinctly because it is ACTIONABLE for a legitimate
 * vendor ("ask for a new link") and is not a meaningful oracle: an attacker who
 * already holds a valid 256-bit token learns nothing from being told it aged
 * out, and one who does not hold a token cannot reach this code at all.
 *
 * `revoked` and `not_found` collapse to a single generic outcome at the route
 * layer — those DO distinguish "this existed and we killed it" from "this never
 * existed", which is an oracle worth denying.
 */
export type CredentialRejection = "not_found" | "revoked" | "expired";

export type InviteValidity =
  | { valid: true }
  | { valid: false; reason: CredentialRejection };

export function checkInviteValidity(
  invite: { expiresAt: Date | string; revokedAt: Date | string | null } | null,
  now: Date = new Date()
): InviteValidity {
  if (!invite) return { valid: false, reason: "not_found" };
  // Revocation beats expiry: an operator who revoked a link should see it
  // reported as revoked even after it would also have aged out.
  if (invite.revokedAt !== null) return { valid: false, reason: "revoked" };
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}

export function checkSessionValidity(
  session:
    | {
        idleExpiresAt: Date | string;
        absoluteExpiresAt: Date | string;
        revokedAt: Date | string | null;
      }
    | null,
  now: Date = new Date()
): InviteValidity {
  if (!session) return { valid: false, reason: "not_found" };
  if (session.revokedAt !== null) return { valid: false, reason: "revoked" };
  const t = now.getTime();
  // BOTH bounds. Checking only one is the classic half-implemented session.
  if (new Date(session.idleExpiresAt).getTime() <= t) return { valid: false, reason: "expired" };
  if (new Date(session.absoluteExpiresAt).getTime() <= t) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true };
}

// ── Cookie ──────────────────────────────────────────────────────────────────

/** Cookie name. Distinct from the internal session cookie — they never mix. */
export const PORTAL_SESSION_COOKIE = "sl_vendor_portal";

/**
 * Cookie attributes.
 *
 * `path` scopes the cookie to the portal API subtree, so it is never sent to
 * any other route — portal or app — even if a vendor navigates there. httpOnly
 * keeps it out of JS, and SameSite=Lax blocks cross-site POSTs while still
 * allowing the top-level navigation the emailed link performs.
 *
 * The path MUST match where the portal routes actually mount
 * (`/api/vendor-portal/...` — see routes/vendorPortal.ts). RFC 6265 sends a
 * cookie only to requests UNDER its path: the original `/vendor-portal` value
 * meant a real browser never attached the cookie to a single API call, and
 * every request after the exchange 401'd. The adversarial suite could not see
 * this because supertest sets the Cookie header manually, which bypasses
 * path matching — the one thing a test harness cannot prove about a cookie.
 */
export function portalCookieOptions(absoluteExpiresAt: Date, isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/api/vendor-portal",
    expires: absoluteExpiresAt,
  };
}
