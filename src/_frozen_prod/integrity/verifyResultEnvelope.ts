import crypto from "crypto";
import type { ResultEnvelopeV1 } from "../product/envelope/ResultEnvelope.v1";
import { getEnvelopePublicKey } from "../signing/resultEnvelopeKey";

export function verifyResultEnvelope(envelope: ResultEnvelopeV1): boolean {
  const recomputedHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  if (recomputedHash !== envelope.payloadHash) return false;
  if (!envelope.signatures || envelope.signatures.length !== 1) return false;

  const sig = envelope.signatures[0];
  if (sig.algorithm !== "ed25519") return false;

  return crypto.verify(
    null,
    Buffer.from(envelope.payloadHash),
    getEnvelopePublicKey(),
    Buffer.from(sig.value, "base64")
  );
}
