import crypto from "crypto";

export function verifyResultEnvelope(envelope: any): boolean {
  const expected = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  if (expected !== envelope.payloadHash) return false;

  if (!envelope.signatures || envelope.signatures.length === 0) return true;

  const sig = envelope.signatures[0];
  if (sig.algorithm !== "sha256") return false;

  return sig.value === envelope.payloadHash;
}
