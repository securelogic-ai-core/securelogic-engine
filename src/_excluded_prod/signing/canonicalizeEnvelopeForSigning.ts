import type { ResultEnvelope } from "../contracts";

export function canonicalizeEnvelopeForSigning(
  envelope: ResultEnvelope
): string {
  const { signatures, attestations, ...rest } = envelope;
  return JSON.stringify(rest);
}
