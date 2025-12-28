import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { verifyPolicy } from "../policy/verifyPolicy";
import type { EnvelopePolicy } from "../policy/PolicyTypes";

export function verifyResultEnvelopeWithPolicy(
  envelope: any,
  requestedCapabilities: string[]
) {
  if (!verifyResultEnvelope(envelope)) {
    return { status: "INVALID_INTEGRITY" };
  }

  const policyResult = verifyPolicy(
    envelope.policy as EnvelopePolicy | undefined,
    requestedCapabilities
  );

  if (!policyResult.valid) {
    return { status: "INVALID_POLICY", reason: policyResult.reason };
  }

  return { status: "VALID" };
}
