import { verifyResultEnvelopeWithResult } from "./verifyResultEnvelopeWithResult";
import { verifyPolicy } from "../policy/verifyPolicy";
import type { EnvelopePolicy } from "../policy/PolicyTypes";

export function verifyResultEnvelopeWithPolicy(
  envelope: any,
  requestedCapabilities: string[]
) {
  const base = verifyResultEnvelopeWithResult(envelope);

  if (base.status !== "VALID") {
    return base;
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
