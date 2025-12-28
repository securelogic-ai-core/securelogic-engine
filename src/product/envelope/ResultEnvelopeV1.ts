import type { EnvelopePayloadV1 } from "./EnvelopePayloadV1";

export interface ResultEnvelopeV1 {
  version: "result-envelope-v1";
  envelopeId: string;
  payload: EnvelopePayloadV1;
  createdAt: string;
}
