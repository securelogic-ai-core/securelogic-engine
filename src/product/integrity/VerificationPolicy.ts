export interface VerificationPolicy {
  requireSignatures: boolean;
  minimumSignatures: number;
  requireLineage: boolean;
  blockReplay: boolean;
}
