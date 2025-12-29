import crypto from "crypto";

export function createResultEnvelopeV1(
  payload: any,
  policy?: {
    allowedCapabilities?: string[];
    licenseTier?: string;
    issuedForTenant?: string;
  }
) {
  const payloadJson = JSON.stringify(payload);

  return {
    version: "v1",
    payload,
    payloadHash: crypto.createHash("sha256").update(payloadJson).digest("hex"),
    issuedAt: new Date().toISOString(),
    signatures: [],
    policy: policy
      ? {
          version: "v1",
          allowedCapabilities: policy.allowedCapabilities ?? [],
        }
      : undefined,
  };
}
