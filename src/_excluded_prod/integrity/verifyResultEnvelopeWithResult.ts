import type { ResultEnvelope } from "../contracts";
import { verifyResultEnvelopeCore } from "./verifyResultEnvelopeCore";
import { verifyResultAttestation } from "./verifyResultAttestation";
import { createChainHash } from "./createChainHash";
import { hasSeenEnvelope, markEnvelopeSeen } from "./replayCache";

export function verifyResultEnvelopeWithResult(envelope: ResultEnvelope) {
  if (envelope.lineage?.parentHash) {
    const expected = createChainHash(
      envelope.result,
      envelope.lineage.parentHash
    );
    if (expected !== envelope.lineage.chainHash) {
      return { status: "INVALID_LINEAGE" as const };
    }
  }

  if (!verifyResultEnvelopeCore(envelope)) {
    return { status: "INVALID_SIGNATURE" as const };
  }

  const attestations = envelope.attestations ?? [];
  let verified = 0;
  for (const att of attestations) {
    if (verifyResultAttestation(envelope, att)) {
      verified++;
    }
  }

  if (hasSeenEnvelope(envelope)) {
    return { status: "INVALID_REPLAY" as const };
  }

  markEnvelopeSeen(envelope);

  return {
    status: "VALID" as const,
    attestationsVerified: verified,
    attestationsTotal: attestations.length,
  };
}
