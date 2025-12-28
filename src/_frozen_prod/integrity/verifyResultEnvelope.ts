import crypto from "crypto";

export function verifyResultEnvelope(envelope: any): boolean {
  const recomputedHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ payload: envelope.payload, metadata: envelope.metadata }))
    .digest("hex");

  if (recomputedHash !== envelope.payloadHash) return false;

  if (envelope.signatures?.length) {
    for (const sig of envelope.signatures) {
      if (sig.algorithm !== "sha256") return false;
    }
  }

  return true;
}
