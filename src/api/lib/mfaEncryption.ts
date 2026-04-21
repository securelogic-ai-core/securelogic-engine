/**
 * mfaEncryption.ts — AES-256-GCM encryption for TOTP secrets stored in the DB.
 *
 * Key source: MFA_SECRET_KEY env var (preferred). Falls back to JWT_SECRET.
 * The raw key material is hashed with SHA-256 to produce a 32-byte AES key,
 * so any string length is acceptable for both env vars.
 *
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */

import crypto from "crypto";

function getKey(): Buffer {
  const raw = (process.env.MFA_SECRET_KEY ?? process.env.JWT_SECRET ?? "").trim();
  if (!raw) throw new Error("MFA_SECRET_KEY or JWT_SECRET not configured");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
