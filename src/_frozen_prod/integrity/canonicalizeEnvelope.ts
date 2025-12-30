import type { ResultEnvelopeV1 } from "../product/envelope/ResultEnvelope.v1";

export function canonicalizeEnvelope(
  envelope: Omit<ResultEnvelopeV1, "signatures">
): Buffer {
  return Buffer.from(
    JSON.stringify(envelope, Object.keys(envelope).sort())
  );
}
