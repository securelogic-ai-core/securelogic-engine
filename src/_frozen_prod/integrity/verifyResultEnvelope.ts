import crypto from "crypto";

export function verifyResultEnvelope(envelope: any) {
  if (!envelope.signature) return false;

  const expected = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  return envelope.signature === expected;
}
