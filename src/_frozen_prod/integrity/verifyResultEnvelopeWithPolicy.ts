import { verifyResultEnvelope } from "./verifyResultEnvelope";

export function verifyResultEnvelopeWithPolicy(
  envelope: any,
  requestedCapabilities: string[]
) {
  if (!verifyResultEnvelope(envelope)) {
    return { status: "INVALID_INTEGRITY" };
  }

  const policy = envelope.policy;

  if (!policy || !policy.allowedCapabilities) {
    return { status: "VALID" };
  }

  const allowed = requestedCapabilities.every(cap =>
    policy.allowedCapabilities.includes(cap)
  );

  if (!allowed) {
    return { status: "INVALID_POLICY" };
  }

  return { status: "VALID" };
}
