import crypto from "crypto";

export function hashResultPayload(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
