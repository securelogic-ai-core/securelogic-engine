import crypto from "node:crypto";
import { logger } from "./logger.js";

/**
 * Enterprise hard limits
 */
const MAX_SIGNATURE_B64_LENGTH = 256; // enough for HMAC-SHA256 base64
const MAX_PAYLOAD_BYTES = 512_000; // 512 KB max signed issue payload
const MIN_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 512;
const MAX_ROTATED_SECRETS = 5;

/**
 * Helpers
 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Enterprise:
 * Support secret rotation.
 *
 * Format:
 *   SECURELOGIC_SIGNING_SECRET="secret_new,secret_old"
 *
 * RULES:
 * - FAIL CLOSED if missing/invalid
 * - Newest secret should be first
 * - Hard cap number of secrets
 */
function getSigningSecrets(): string[] {
  const raw = process.env.SECURELOGIC_SIGNING_SECRET;

  if (!isNonEmptyString(raw)) return [];

  const secrets = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (secrets.length === 0) return [];

  if (secrets.length > MAX_ROTATED_SECRETS) return [];

  for (const s of secrets) {
    if (s.length < MIN_SECRET_LENGTH) return [];
    if (s.length > MAX_SECRET_LENGTH) return [];
  }

  return secrets;
}

/**
 * Canonical JSON stringify.
 * Prevents signature mismatch caused by object key ordering.
 *
 * RULE:
 * - Only supports JSON-safe values.
 */
function canonicalize(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null) return null;

    const t = typeof v;

    if (t === "string" || t === "number" || t === "boolean") return v;

    if (t === "bigint") return v.toString();

    if (t === "undefined" || t === "function" || t === "symbol") return null;

    if (Array.isArray(v)) return v.map(normalize);

    if (t === "object") {
      if (seen.has(v)) {
        throw new Error("payload_not_serializable_cyclic");
      }

      seen.add(v);

      const keys = Object.keys(v).sort();
      const out: Record<string, any> = {};

      for (const k of keys) {
        out[k] = normalize(v[k]);
      }

      return out;
    }

    return null;
  };

  return JSON.stringify(normalize(value));
}

function normalizeSignatureB64(raw: unknown): string | null {
  if (!isNonEmptyString(raw)) return null;

  const trimmed = raw.trim();

  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SIGNATURE_B64_LENGTH) return null;

  /**
   * Strict base64 charset.
   * NOTE: base64 can include = padding.
   */
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) return null;

  /**
   * Enforce correct padding.
   * base64 length must be divisible by 4.
   */
  if (trimmed.length % 4 !== 0) return null;

  return trimmed;
}

function safeEqualBase64(aB64: string, bB64: string): boolean {
  try {
    const a = Buffer.from(aB64, "base64");
    const b = Buffer.from(bB64, "base64");

    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function computeHmacB64(secret: string, msg: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(msg, "utf8")
    .digest("base64");
}

/**
 * verifyIssueSignature (Enterprise-grade)
 *
 * RULES:
 * - FAIL CLOSED if secret missing/invalid
 * - Accepts secret rotation list
 * - Never reveals "missing vs invalid signature"
 * - Constant-time compare
 */
export function verifyIssueSignature(
  payload: unknown,
  signatureB64: string
): boolean {
  const secrets = getSigningSecrets();

  /**
   * FAIL CLOSED.
   * If secret is missing/weak, nothing can be trusted.
   */
  if (secrets.length === 0) {
    logger.error(
      { component: "verifyIssueSignature", hasSecret: false },
      "SECURELOGIC_SIGNING_SECRET missing/invalid"
    );
    return false;
  }

  const normalizedSig = normalizeSignatureB64(signatureB64);

  /**
   * IMPORTANT:
   * Do not reveal missing vs invalid signature.
   */
  if (!normalizedSig) {
    return false;
  }

  let msg: string;

  /**
   * Canonicalize payload deterministically.
   * This is the difference between "works in dev" and "never breaks in prod."
   */
  try {
    msg = canonicalize(payload);
  } catch (err) {
    logger.warn(
      { err, component: "verifyIssueSignature" },
      "Payload could not be canonicalized"
    );
    return false;
  }

  /**
   * Hard cap payload size to prevent CPU abuse.
   */
  const bytes = Buffer.byteLength(msg, "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    logger.warn(
      { component: "verifyIssueSignature", bytes },
      "Payload exceeded maximum allowed size"
    );
    return false;
  }

  /**
   * Rotation support:
   * - Compute signature for every secret
   * - Constant-time compare
   * - No early return
   */
  let match = false;

  for (const secret of secrets) {
    const expected = computeHmacB64(secret, msg);

    if (safeEqualBase64(expected, normalizedSig)) {
      match = true;
    } else {
      /**
       * Side-channel reduction:
       * Do work even on mismatch.
       */
      safeEqualBase64(expected, expected);
    }
  }

  return match;
}