import crypto from "crypto";
import type { ResultEnvelopeV1 } from "../product/envelope/ResultEnvelope.v1";
import { getEnvelopePrivateKey } from "./resultEnvelopeKey";

export function signResultEnvelope(
  envelope: ResultEnvelopeV1
): ResultEnvelopeV1 {
  const sig = crypto.sign(
    null,
    Buffer.from(envelope.payloadHash),
    getEnvelopePrivateKey()
  );

  return {
    ...envelope,
    signatures: [
      {
        value: sig.toString("base64"),
        algorithm: "ed25519",
      },
    ],
  };
}
