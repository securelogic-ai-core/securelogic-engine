/**
 * tokenDigest.ts — digest-at-rest for the three LEGACY capability-token
 * families that predate the platform's own hash-at-rest convention
 * (token-at-rest hardening package, 2026-08-17):
 *
 *   users.email_verification_token · users.password_reset_token ·
 *   org_invites.token
 *
 * Every NEWER token family already stores a digest (api_keys.key_hash,
 * data_export_files.download_token_hash, sso_login_codes.code_hash,
 * vendor_portal_sessions.session_token_hash, bcrypt'd MFA backup codes).
 * These three stored the RAW 64-hex token and looked it up by raw equality —
 * so any read of the row (SQLi, backup leak, log capture) yielded a live
 * account-takeover / org-membership credential.
 *
 * SCHEME — same posture as dataExportDownloadToken.ts (plain SHA-256 of a
 * 256-bit random token; no server secret; security rests on token entropy +
 * bounded expiry + single use), with ONE deliberate difference: the stored
 * form is PREFIXED (`sha256:<hex>`) so a digest is self-identifying. That
 * matters because these families need a legacy-compatibility window:
 *
 *   lookup = WHERE col = digest(presented) OR col = presented
 *
 * The second (legacy) arm can only ever match a plain-64-hex RAW value from a
 * row issued before this change — it can never match a stored digest, because
 * digests carry the prefix and presented tokens are SHAPE-VALIDATED to plain
 * 64-hex before any lookup (`isPresentableToken`). Net effect, proven in the
 * package tests: a stolen stored digest is NOT redeemable, while in-flight
 * legacy tokens keep working for their (1h / 24h / 7d) TTLs and are consumed
 * exactly as before. The legacy arm becomes dead code once those TTLs lapse
 * and can be removed in a follow-up.
 */

import crypto from "crypto";

const DIGEST_PREFIX = "sha256:";

/** Shape of every presentable token in these families: plain 64-hex. */
const PRESENTABLE_TOKEN_RE = /^[a-f0-9]{64}$/;

/**
 * True iff `value` is shaped like a raw presentable token. Lookups MUST refuse
 * anything else before touching the database — this is what makes a leaked
 * stored digest (`sha256:…`) unusable as a token.
 */
export function isPresentableToken(value: unknown): value is string {
  return typeof value === "string" && PRESENTABLE_TOKEN_RE.test(value);
}

/** The stored form: prefixed plain SHA-256 hex of the raw token. */
export function digestToken(rawToken: string): string {
  return DIGEST_PREFIX + crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** True iff a STORED value is a digest (vs a legacy raw token). */
export function isTokenDigest(stored: string): boolean {
  return stored.startsWith(DIGEST_PREFIX);
}
