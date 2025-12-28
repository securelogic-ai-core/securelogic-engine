import crypto from "crypto";

export function verifyResultEnvelope(envelope: any): boolean {
  const recomputed = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  return recomputed === envelope.payloadHash;
}
