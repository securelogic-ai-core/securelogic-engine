import type { ResultEnvelope, VerificationReceiptV1 } from "../contracts";

export function buildVerificationReceipt(
  envelope: ResultEnvelope,
  valid: boolean
): VerificationReceiptV1 {
  return {
    version: "verification-receipt-v1",
    envelopeId: envelope.envelopeId,
    verifiedAt: new Date().toISOString(),
    valid,
    attestationCount: envelope.attestations?.length ?? 0,
    signatureCount: envelope.signatures?.length ?? 0
  };
}
