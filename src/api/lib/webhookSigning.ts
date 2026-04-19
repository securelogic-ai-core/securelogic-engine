import crypto from "crypto";

export function generateWebhookSecret(): string {
  return "whsec_" + crypto.randomBytes(32).toString("base64url");
}

export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp: number
): string {
  const toSign = `${timestamp}.${payload}`;
  return (
    "sha256=" +
    crypto
      .createHmac("sha256", secret.replace("whsec_", ""))
      .update(toSign)
      .digest("hex")
  );
}

export function buildWebhookHeaders(
  payload: string,
  secret: string
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhookPayload(payload, secret, timestamp);
  return {
    "Content-Type": "application/json",
    "X-SecureLogic-Signature": signature,
    "X-SecureLogic-Timestamp": String(timestamp),
    "X-SecureLogic-Event-Version": "1",
    "User-Agent": "SecureLogic-Webhooks/1.0",
  };
}

export function maskSecret(secret: string): string {
  if (secret.length <= 14) return secret.slice(0, 8) + "...";
  return secret.slice(0, 8) + "..." + secret.slice(-6);
}
