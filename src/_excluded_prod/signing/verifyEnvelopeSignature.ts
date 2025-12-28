import type { ResultEnvelope } from "../contracts";

export function verifyEnvelopeSignature(envelope: ResultEnvelope): boolean {
  if (!envelope.signatures || envelope.signatures.length === 0) return false;
  return envelope.signatures.every(sig => typeof sig.value === "string");
}
