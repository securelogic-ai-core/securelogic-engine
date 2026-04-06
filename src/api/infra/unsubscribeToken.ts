import crypto from "crypto";

/**
 * Reads UNSUBSCRIBE_SECRET from the environment at call time.
 *
 * In production: throws if the secret is missing or empty — validateEnv()
 * catches this at startup so it should never reach here unset.
 *
 * In development: falls back to a known default so local work doesn't
 * require the env var. The fallback is intentionally distinct from any
 * real secret value to make accidental production use obvious in logs.
 */
function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET?.trim();

  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("UNSUBSCRIBE_SECRET is not set — cannot generate or verify unsubscribe tokens");
  }

  return "dev_secret_change_me";
}

export function generateUnsubscribeToken(email: string): string {
  const hmac = crypto.createHmac("sha256", getSecret());
  hmac.update(email.trim().toLowerCase());
  return hmac.digest("hex");
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(email);

  if (!token || token.length !== expected.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(token)
    );
  } catch {
    return false;
  }
}
