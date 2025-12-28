import type { ResultEnvelope } from "../contracts";
import { verifyResultEnvelopeCore } from "./verifyResultEnvelopeCore";
import { verifyResultAttestation } from "./verifyResultAttestation";
import { createChainHash } from "./createChainHash";
import { hasSeenEnvelope, markEnvelopeSeen } from "./replayCache";

export function verifyResultEnvelopeWithResult(envelope: ResultEnvelope) {
  // 1. LINEAGE
  if (envelope.lineage?.parentHash) {
    const expected = createChainHash(
      envelope.result,
      envelope.lineage.parentHash
    );
    if (expected !== envelope.lineage.chainHash) {
      return { status: "INVALID_LINEAGE" as const };
    }
  }

  // 2. SIGNATURES
  if (!verifyResultEnvelopeCore(envelope)) {
    return { status: "INVALID_SIGNATURE" as const };
  }

  // 3. ATTESTATIONS
  const attestations = envelope.attestations ?? [];
  let verified = 0;
  for (const att of attestations) {
    if (verifyResultAttestation(envelope, att)) {
      verified++;
    }
  }

  // 4. REPLAY (ONLY AFTER VALID)
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
