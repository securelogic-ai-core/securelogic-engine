import crypto from "crypto";
import type { OpinionV1 } from "../OpinionV1";
import type { OpinionEnvelopeV1 } from "./OpinionEnvelopeV1";
import { signResultEnvelope } from "../../_frozen_prod/signing/signResultEnvelope";

export function createOpinionEnvelopeV1(
  opinion: OpinionV1
): OpinionEnvelopeV1 {
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(opinion))
    .digest("hex");

  const envelope: OpinionEnvelopeV1 = {
    kind: "OpinionEnvelope",
    version: "v1",
    payload: opinion,
    payloadHash,
    signatures: []
  };

  signResultEnvelope(envelope as any);
  return envelope;
}
