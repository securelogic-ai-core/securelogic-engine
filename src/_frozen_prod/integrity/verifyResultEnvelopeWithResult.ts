import { checkReplay } from "./replayCache";
import { verifyResultEnvelope } from "./verifyResultEnvelope";

export function verifyResultEnvelopeWithResult(envelope: any) {
  if (checkReplay(envelope.nonce)) {
    return { status: "INVALID_REPLAY" };
  }

  return verifyResultEnvelope(envelope)
    ? { status: "VALID" }
    : { status: "INVALID" };
}
