import crypto from "crypto";
import type { EnvelopePolicy } from "../../policy/PolicyTypes";

export function createResultEnvelopeV1(
  payload: any,
  policy?: EnvelopePolicy
) {
  const payloadJson = JSON.stringify(payload);

  return {
    version: "v1",
    payload,
    payloadHash: crypto
      .createHash("sha256")
      .update(payloadJson)
      .digest("hex"),
    issuedAt: new Date().toISOString(),
    signatures: [],
    policy: policy
      ? {
          allowedCapabilities: [...policy.allowedCapabilities],
          licenseTier: policy.licenseTier,
          issuedForTenant: policy.issuedForTenant,
          version: policy.version,
        }
      : undefined,
  };
}
