import type { ResultEnvelopeV1 } from "../types/ResultEnvelope";

export function signResultEnvelope(envelope: ResultEnvelopeV1) {
  return { ...envelope, signature: "test-signature" };
}
