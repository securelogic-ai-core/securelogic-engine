import type { ResultEnvelopeV1 } from "../product/envelope/ResultEnvelope.v1";

export function verifyResultEnvelopeWithPolicy(
  envelope: ResultEnvelopeV1,
  requestedFromCaller: string[]
) {
  const policy = envelope.policy;
  if (!policy) return { status: "VALID" as const };

  const requested =
    policy.requestedCapabilities ?? requestedFromCaller ?? [];

  if (policy.licenseTier === "CORE" && requested.includes("write")) {
    return { status: "INVALID_POLICY" as const };
  }

  return { status: "VALID" as const };
}
