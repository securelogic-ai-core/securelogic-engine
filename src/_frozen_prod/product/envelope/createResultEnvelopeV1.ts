import crypto from "crypto";

export function createResultEnvelopeV1(payload: any) {
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return {
    version: "v1",
    payload,
    payloadHash,
    issuedAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    signatures: [],
  };
}
