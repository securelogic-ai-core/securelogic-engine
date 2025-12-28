import type { ResultEnvelope } from "../contracts";
import { verifyResultEnvelopeCore } from "./verifyResultEnvelopeCore";
import { hasSeenEnvelope, markEnvelopeSeen } from "./replayCache";

export function verifyResultEnvelope(envelope: ResultEnvelope): boolean {
  // 1. Cryptographic & structural integrity
  if (!verifyResultEnvelopeCore(envelope)) {
    return false;
  }

  const hasSignatures = (envelope.signatures?.length ?? 0) > 0;

  // 2. Replay protection ONLY for signed envelopes
  if (hasSignatures) {
    if (hasSeenEnvelope(envelope)) {
      return false;
    }
    markEnvelopeSeen(envelope);
  }

  return true;
}
