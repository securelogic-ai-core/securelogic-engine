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

  const policy: EnvelopePolicy | undefined = envelope.policy;

  if (!policy) {
    return { status: "VALID" };
  }

  const result = verifyPolicy(policy, requestedCapabilities);

  if (!result.allowed) {
    return { status: "INVALID_POLICY" };
  }

  return { status: "VALID" };
}
