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

  // Canonical policy resolution (DO NOT CHANGE ORDER)
  const policy: EnvelopePolicy | undefined =
    envelope.payload?.policy ??
    envelope.policy ??
    envelope.payload?.meta?.policy;

  if (!policy) {
    return { status: "INVALID_POLICY" };
  }

  const result = verifyPolicy(policy, requestedCapabilities);

  if (!result.valid) {
    return { status: "INVALID_POLICY" };
  }

  return { status: "VALID" };
}
