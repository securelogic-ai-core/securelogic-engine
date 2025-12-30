import crypto from "crypto";
import type { ResultEnvelopeV1 } from "./ResultEnvelope.v1";
import { signResultEnvelope } from "../../signing/signResultEnvelope";

export function createResultEnvelopeV1(
  payload: unknown,
  policy?: ResultEnvelopeV1["policy"]
): ResultEnvelopeV1 {
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return signResultEnvelope({
    version: "v1",
    payload,
    payloadHash,
    signatures: [],
    policy,
  });
}
