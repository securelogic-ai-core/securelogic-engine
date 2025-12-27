import type { ResultEnvelope } from "../contracts";
import type { VerificationResult } from "./VerificationResult";
import { verifyResultEnvelope } from "./verifyResultEnvelope";

export function verifyResultEnvelopeWithResult(
  envelope: ResultEnvelope
): VerificationResult {
  const valid = verifyResultEnvelope(envelope);

  return {
    status: valid ? "VALID" : "INVALID_PAYLOAD",
    verifiedAt: new Date().toISOString(),
    details: []
  };
}
