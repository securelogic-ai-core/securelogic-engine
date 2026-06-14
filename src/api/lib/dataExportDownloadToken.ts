/**
 * dataExportDownloadToken.ts — download-token minting + hashing for GDPR/CCPA
 * export bundles (data-subject-rights workstream, PR #5).
 *
 * The token model mirrors customerApiKeys exactly (Decision D):
 *   • the RAW token is `crypto.randomBytes(32)` (256-bit) hex-encoded;
 *   • only a PLAIN SHA-256 hash of the raw token is ever persisted
 *     (`data_export_files.download_token_hash`) — never the raw token;
 *   • the download route hashes the presented token and looks the row up BY
 *     that hash (a unique index), so a DB read never exposes a usable token.
 *
 * This is intentionally NOT an HMAC: there is no server-side secret in the
 * scheme. Security rests on the 256 bits of entropy in the token itself, the
 * unique-hash lookup, and a bounded expiry — the same posture as an API key.
 * (The PR #1 migration comment originally said "HMAC-SHA256"; PR #5 corrects it
 * to "SHA-256" so the schema doc and this code agree.)
 *
 * The worker mints the token at export completion (dataRightsWorker.recordSuccess)
 * and stores only the hash + expiry; in PR #5 the raw token is discarded because
 * there is no sender yet (email is deferred to PR #4). The tokenized download
 * route is built and tested against directly-minted tokens.
 */

import crypto from "crypto";

/**
 * Download-link lifetime. Matched to the O-11 7-day R2 bundle lifetime so the
 * token never outlives the object it points at (and vice-versa).
 */
export const DOWNLOAD_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 256-bit random token, hex-encoded (customerApiKeys convention). */
export function generateDownloadToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Plain SHA-256 hex of a token — exactly what is stored in download_token_hash. */
export function hashDownloadToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface MintedDownloadToken {
  /** Raw token — only ever surfaced to the (future) email link; never persisted. */
  token: string;
  /** SHA-256 of `token` — persisted in data_export_files.download_token_hash. */
  tokenHash: string;
  /** Absolute expiry — persisted in data_export_files.download_token_expires_at. */
  expiresAt: Date;
}

/**
 * Mint a fresh download token, its hash, and its expiry. `now` is injectable so
 * the worker can thread its deterministic clock and tests can assert expiry.
 */
export function mintDownloadToken(now: Date = new Date()): MintedDownloadToken {
  const token = generateDownloadToken();
  return {
    token,
    tokenHash: hashDownloadToken(token),
    expiresAt: new Date(now.getTime() + DOWNLOAD_TOKEN_TTL_MS),
  };
}
