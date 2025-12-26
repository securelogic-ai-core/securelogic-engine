import type { ResultEnvelope } from "../contracts";

type EnvelopeWithPayload = ResultEnvelope & {
  payload?: ResultEnvelope;
};

export function verifyResultEnvelope(envelope: EnvelopeWithPayload): boolean {
  if (typeof envelope !== "object" || envelope === null) return false;

  if (envelope.version !== "result-envelope-v1") return false;
  if (typeof envelope.issuedAt !== "string") return false;
  if (typeof envelope.result !== "object" || envelope.result === null) return false;

  if (envelope.payload) {
    if (envelope.payload.version !== envelope.version) return false;
    if (envelope.payload.issuedAt !== envelope.issuedAt) return false;
  }

  return true;
}
