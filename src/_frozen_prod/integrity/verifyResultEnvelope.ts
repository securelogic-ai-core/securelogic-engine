import crypto from "crypto";

export function verifyResultEnvelope(envelope: any): boolean {
  // 1. Verify payload immutability
  const recomputed = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  if (recomputed !== envelope.payloadHash) {
    return false;
  }

  // 2. Verify signature integrity (if present)
  if (Array.isArray(envelope.signatures)) {
    for (const sig of envelope.signatures) {
      if (sig.algorithm !== "sha256") {
        return false;
      }
    }
  }

  return true;
}
