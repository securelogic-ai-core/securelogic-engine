/**
 * fieldEncryption.ts — AES-256-GCM application-layer field encryption.
 *
 * Encrypts sensitive fields (raw_payload, report_json, content_json) at the
 * application layer before they are written to the database, and decrypts
 * them on read.
 *
 * KEY FORMAT
 * ----------
 * FIELD_ENCRYPTION_KEY must be a 64-character hex string representing 32
 * random bytes. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * CIPHERTEXT FORMAT
 * -----------------
 * Stored as: base64(iv):base64(ciphertext)
 *   iv         — 12-byte random nonce (GCM standard)
 *   ciphertext — AES-256-GCM encrypted bytes + 16-byte auth tag appended
 *
 * BEHAVIOUR WHEN KEY IS ABSENT
 * ----------------------------
 * If FIELD_ENCRYPTION_KEY is not set:
 *   - encryptField returns the plaintext unchanged (passthrough)
 *   - decryptField returns the ciphertext unchanged
 *   - A warning is logged once at module load time
 *
 * This allows development environments to run without the key.
 * In production, startupCheck.ts enforces that the key is present and
 * exactly 64 hex characters.
 *
 * USAGE
 * -----
 *   import { encryptField, decryptField } from "../lib/fieldEncryption.js";
 *
 *   // Before DB write (stringify JSONB first)
 *   const encrypted = encryptField(JSON.stringify(rawPayload));
 *
 *   // After DB read (then parse back)
 *   const decrypted = JSON.parse(decryptField(row.raw_payload));
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "../infra/logger.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;       // GCM standard nonce length
const AUTH_TAG_BYTES = 16; // GCM standard auth tag length

// ---------------------------------------------------------------------------
// Key loading
// ---------------------------------------------------------------------------

const HEX_64_RE = /^[0-9a-f]{64}$/i;

/** Sentinel used to detect passthrough mode. */
let encryptionKey: Buffer | null = null;
let passthroughWarned = false;

function loadKey(): Buffer | null {
  const raw = (process.env.FIELD_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;

  if (!HEX_64_RE.test(raw)) {
    logger.warn(
      { event: "field_encryption_key_invalid" },
      "FIELD_ENCRYPTION_KEY is set but is not a valid 64-character hex string — field encryption DISABLED"
    );
    return null;
  }

  return Buffer.from(raw, "hex");
}

function getKey(): Buffer | null {
  if (encryptionKey !== null) return encryptionKey;

  encryptionKey = loadKey();

  if (encryptionKey === null && !passthroughWarned) {
    passthroughWarned = true;
    logger.warn(
      { event: "field_encryption_disabled" },
      "FIELD_ENCRYPTION_KEY is not set — sensitive fields stored as plaintext. Set this variable in production."
    );
  }

  return encryptionKey;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * If FIELD_ENCRYPTION_KEY is not set, returns plaintext unchanged (dev mode).
 *
 * @param plaintext - UTF-8 string to encrypt (serialize JSONB before calling).
 * @returns Encoded ciphertext: "base64(iv):base64(ciphertext+authtag)"
 */
export function encryptField(plaintext: string): string {
  const key = getKey();
  if (key === null) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();
  const cipherWithTag = Buffer.concat([encrypted, authTag]);

  return `${iv.toString("base64")}:${cipherWithTag.toString("base64")}`;
}

/**
 * Decrypt a ciphertext produced by encryptField().
 *
 * If FIELD_ENCRYPTION_KEY is not set, or the value does not match the
 * "iv:ciphertext" format (i.e. it was stored as plaintext), returns the
 * input unchanged (passthrough / backwards-compatibility).
 *
 * @param ciphertext - Encoded string: "base64(iv):base64(ciphertext+authtag)"
 * @returns Decrypted UTF-8 string.
 */
export function decryptField(ciphertext: string): string {
  const key = getKey();
  if (key === null) return ciphertext;

  // If value doesn't contain the separator it was stored as plaintext
  // (legacy row or dev migration). Return as-is.
  const separatorIdx = ciphertext.indexOf(":");
  if (separatorIdx === -1) return ciphertext;

  try {
    const iv = Buffer.from(ciphertext.slice(0, separatorIdx), "base64");
    const cipherWithTag = Buffer.from(ciphertext.slice(separatorIdx + 1), "base64");

    if (iv.length !== IV_BYTES || cipherWithTag.length < AUTH_TAG_BYTES) {
      // Doesn't look like a valid encrypted value — return as-is
      return ciphertext;
    }

    const tag = cipherWithTag.slice(cipherWithTag.length - AUTH_TAG_BYTES);
    const encrypted = cipherWithTag.slice(0, cipherWithTag.length - AUTH_TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(tag);

    return decipher.update(encrypted) + decipher.final("utf8");
  } catch (err) {
    logger.error(
      { event: "field_decryption_failed", err },
      "AES-256-GCM decryption failed — returning raw value"
    );
    // Return raw value rather than throwing — let the caller decide what to do.
    return ciphertext;
  }
}
