import crypto from "node:crypto";
import { logger } from "./logger.js";

function getSigningSecret(): string | null {
  const secret = process.env.SECURELOGIC_SIGNING_SECRET;
  if (!secret) return null;

  const trimmed = secret.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function verifyIssueSignature(
  payload: unknown,
  signatureB64: string
): boolean {
  const secret = getSigningSecret();

  // FAIL CLOSED
  if (!secret) {
    logger.error(
      { hasSecret: false },
      "verifyIssueSignature: SECURELOGIC_SIGNING_SECRET missing/empty"
    );
    return false;
  }

  if (!signatureB64 || signatureB64.trim().length === 0) {
    logger.warn("verifyIssueSignature: missing signature");
    return false;
  }

  // Canonicalize payload deterministically
  const msg = JSON.stringify(payload);

  // Compute expected signature (HMAC-SHA256 base64)
  const expected = crypto
    .createHmac("sha256", secret)
    .update(msg, "utf8")
    .digest("base64");

  // Timing-safe compare
  try {
    const a = Buffer.from(signatureB64, "base64");
    const b = Buffer.from(expected, "base64");

    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    logger.error({ err }, "verifyIssueSignature: compare failed");
    return false;
  }
}