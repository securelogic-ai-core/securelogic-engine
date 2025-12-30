import type { OpinionV1 } from "../OpinionV1";

export interface OpinionEnvelopeV1 {
  kind: "OpinionEnvelope";
  version: "v1";

  payload: OpinionV1;
  payloadHash: string;
  signatures: {
    keyId: string;
    algorithm: "ed25519";
    value: string;
  }[];
}
