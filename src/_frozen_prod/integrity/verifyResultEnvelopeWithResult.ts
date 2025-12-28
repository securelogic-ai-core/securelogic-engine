import { verifyResultEnvelope } from "./verifyResultEnvelope";

export function verifyResultEnvelopeWithResult(envelope: any) {
  return verifyResultEnvelope(envelope)
    ? { status: "VALID" }
    : { status: "INVALID" };
}
