import type { ResultEnvelope } from "../contracts";
import { verifyResultEnvelopeCore } from "./verifyResultEnvelopeCore";
import { hasSeenEnvelope, markEnvelopeSeen } from "./replayCache";

export function verifyResultEnvelope(envelope: ResultEnvelope): boolean {
  if (!verifyResultEnvelopeCore(envelope)) {
    return false;
  }

  if (hasSeenEnvelope(envelope)) {
    return false;
  }

  markEnvelopeSeen(envelope);
  return true;
}
