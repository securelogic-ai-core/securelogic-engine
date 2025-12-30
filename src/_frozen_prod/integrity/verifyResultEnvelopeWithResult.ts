import type { ResultEnvelopeV1 } from "../product/envelope/ResultEnvelope.v1";
import { verifyResultEnvelope } from "./verifyResultEnvelope";

const seen = new Set<string>();

export function verifyResultEnvelopeWithResult(envelope: ResultEnvelopeV1) {
  if (!verifyResultEnvelope(envelope)) {
    return { status: "INVALID_SIGNATURE" as const };
  }

  if (seen.has(envelope.payloadHash)) {
    return { status: "INVALID_REPLAY" as const };
  }

  seen.add(envelope.payloadHash);
  return { status: "VALID" as const };
}
