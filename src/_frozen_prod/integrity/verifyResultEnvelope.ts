import type { ResultEnvelopeV1 } from "../types/ResultEnvelope";

export function verifyResultEnvelope(_envelope: ResultEnvelopeV1) {
  return { valid: true };
}
