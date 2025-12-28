import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { verifyPolicy } from "../policy/verifyPolicy";
import type { EnvelopePolicy } from "../policy/PolicyTypes";

export function verifyResultEnvelopeWithPolicy(
  envelope: any,
  requestedCapabilities: string[]
) {
  // Integrity only (no replay)
  if (!verifyResultEnvelope(envelope)) {
    return { status: "INVALID_INTEGRITY" };
  }

  // Locate policy (tests embed in payload)
  const rawPolicy =
    envelope.payload?.policy ??
    envelope.payload?.meta?.policy ??
    envelope.policy;

  // NO POLICY = NO RESTRICTION
  if (!rawPolicy) {
    return { status: "VALID" };
  }

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
