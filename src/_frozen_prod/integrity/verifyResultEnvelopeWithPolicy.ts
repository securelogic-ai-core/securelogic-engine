import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { verifyPolicy } from "../policy/verifyPolicy";
import type { EnvelopePolicy } from "../policy/PolicyTypes";

export function verifyResultEnvelopeWithPolicy(
  envelope: any,
  requestedCapabilities: string[]
) {
  // Integrity ONLY (no replay)
  if (!verifyResultEnvelope(envelope)) {
    return { status: "INVALID_INTEGRITY" };
  }

  // Extract raw policy (tests embed it in payload)
  const rawPolicy =
    envelope.payload?.policy ??
    envelope.policy ??
    envelope.payload?.meta?.policy;

  if (!rawPolicy) {
    return { status: "INVALID_POLICY" };
  }

  // NORMALIZE to EnvelopePolicy contract
  const policy: EnvelopePolicy = {
    allowedCapabilities:
      rawPolicy.allowedCapabilities ??
      rawPolicy.capabilities ??
      [],
  };

  const result = verifyPolicy(policy, requestedCapabilities);

  if (!result.valid) {
    return { status: "INVALID_POLICY" };
  }

  return { status: "VALID" };
}
