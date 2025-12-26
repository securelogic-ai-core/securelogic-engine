import type { ResultEnvelopeV1 } from "../factories/ResultEnvelopeFactory";
import crypto from "crypto";

export function verifyResultEnvelope(envelope: ResultEnvelopeV1): boolean {
  const recalculated = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  return (
    envelope.integrity.algorithm === "sha256" &&
    envelope.integrity.hash === recalculated
  );
}
