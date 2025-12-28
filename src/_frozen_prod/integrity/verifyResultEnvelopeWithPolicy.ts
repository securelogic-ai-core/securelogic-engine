import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { verifyPolicy } from "../policy/verifyPolicy";
import type { EnvelopePolicy } from "../policy/PolicyTypes";

export function verifyResultEnvelopeWithPolicy(
  envelope: any,
  requestedCapabilities: string[]
) {
  // integrity + signature ONLY (no replay)
  if (!verifyResultEnvelope(envelope)) {
    return { status: "INVALID_INTEGRITY" };
  }

  const policy: EnvelopePolicy | undefined =
    envelope.payload?.policy ?? envelope.policy;

  if (!policy) {
    return { status: "INVALID_POLICY" };
  }

  const policyResult = verifyPolicy(policy, requestedCapabilities);

  if (!policyResult.valid) {
    return { status: "INVALID_POLICY" };
  }

  return { status: "VALID" };
}
