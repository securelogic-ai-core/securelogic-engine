import crypto from "crypto";

export function createResultEnvelopeV1(payload: any, policy?: any) {
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return {
    version: "v1",
    payload,
    payloadHash,
    policy,
    issuedAt: new Date().toISOString(),
    signatures: []
  };
}
