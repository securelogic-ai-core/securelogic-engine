export interface VerificationPolicy {
  requireSignatures: boolean;
  requireAttestations: boolean;
  minSignatures?: number;
  minAttestations?: number;
  allowExpired?: boolean;
}
