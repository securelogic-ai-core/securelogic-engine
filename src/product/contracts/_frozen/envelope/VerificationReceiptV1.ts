export interface VerificationReceiptV1 {
  version: "verification-receipt-v1";
  envelopeId: string;
  verifiedAt: string;
  valid: boolean;
  attestationCount: number;
  signatureCount: number;
}
