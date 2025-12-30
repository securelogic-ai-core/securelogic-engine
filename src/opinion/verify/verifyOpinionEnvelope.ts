import crypto from "crypto";
import type { OpinionEnvelopeV1 } from "../envelope/OpinionEnvelopeV1";
import { getEnvelopePublicKey } from "../../_frozen_prod/signing/resultEnvelopeKey";

export function verifyOpinionEnvelope(
  envelope: OpinionEnvelopeV1
): { status: "VALID" | "INVALID_SIGNATURE" | "INVALID_HASH" } {
  const recomputed = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  if (recomputed !== envelope.payloadHash) {
    return { status: "INVALID_HASH" };
  }

  const sig = envelope.signatures?.[0];
  if (!sig) return { status: "INVALID_SIGNATURE" };

  const publicKey = getEnvelopePublicKey(sig.keyId);

  const ok = crypto.verify(
    null,
    Buffer.from(envelope.payloadHash),
    publicKey,
    Buffer.from(sig.value, "base64")
  );

  return ok ? { status: "VALID" } : { status: "INVALID_SIGNATURE" };
}
