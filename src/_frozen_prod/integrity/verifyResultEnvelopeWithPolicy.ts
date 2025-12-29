import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { verifyPolicy } from "../policy/verifyPolicy";

export function verifyResultEnvelopeWithPolicy(
  envelope: any,
  requestedCapabilities: string[]
) {
  if (!verifyResultEnvelope(envelope)) {
    return { status: "INVALID_INTEGRITY" };
  }

  const policy = envelope.policy;
  const result = verifyPolicy(policy, requestedCapabilities);

  if (!result.valid) {
    return { status: "INVALID_POLICY" };
  }

  return { status: "VALID" };
}
