import crypto from "crypto";

const SECRET = process.env.UNSUBSCRIBE_SECRET || "dev_secret_change_me";

export function generateUnsubscribeToken(email: string): string {
  const hmac = crypto.createHmac("sha256", SECRET);
  hmac.update(email);
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
