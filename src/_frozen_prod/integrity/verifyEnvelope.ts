import type { ResultEnvelopeV1 } from "../product/envelope/ResultEnvelope.v1";
import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { verifyResultEnvelopeWithPolicy } from "./verifyResultEnvelopeWithPolicy";

export function verifyEnvelope(
  envelope: ResultEnvelopeV1,
  requested: string[]
) {
  const policy = verifyResultEnvelopeWithPolicy(envelope, requested);
  if (policy.status !== "VALID") return policy;

  const sigValid = verifyResultEnvelope(envelope);
  if (!sigValid) return { status: "INVALID_SIGNATURE" as const };

  return { status: "VALID" as const };
}
