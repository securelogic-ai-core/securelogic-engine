import crypto from "crypto";

export function createResultEnvelopeV1(payload: any) {
  const issuedAt = new Date().toISOString();

  const metadata = {
    engineVersion: "0.3.3",
    issuedBy: "securelogic-engine",
    environment: "prod" as const,
  };

  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ payload, metadata }))
    .digest("hex");

  return {
    version: "v1",
    issuedAt,
    metadata,
    payload,
    payloadHash,
    signatures: [],
  };
}
