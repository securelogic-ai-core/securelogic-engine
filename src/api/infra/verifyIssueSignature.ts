import crypto from "node:crypto";
import { logger } from "./logger.js";

function getVerifyKey(): string | null {
  const key = process.env.SECURELOGIC_ISSUE_VERIFY_KEY;
  if (!key) return null;

  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function verifyIssueSignature(payload: unknown, signatureB64: string): boolean {
  const verifyKey = getVerifyKey();

  // FAIL CLOSED: if key is missing, verification must fail
  if (!verifyKey) {
    logger.error(
      { hasKey: false },
      "verifyIssueSignature: SECURELOGIC_ISSUE_VERIFY_KEY missing/empty"
    );
    return false;
  }

  // Basic signature sanity
  if (!signatureB64 || signatureB64.trim().length === 0) {
    logger.warn("verifyIssueSignature: missing signature");
    return false;
  }

  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64, "base64");
  } catch {
    logger.warn("verifyIssueSignature: invalid base64 signature");
    return false;
  }

  // Canonicalize payload deterministically
  const msg = Buffer.from(JSON.stringify(payload), "utf8");

  try {
    return crypto.verify(
      "sha256",
      msg,
      verifyKey, // <- now guaranteed string, not undefined
      sig
    );
  } catch (err) {
    logger.error({ err }, "verifyIssueSignature: crypto.verify threw");
    return false;
  }
}