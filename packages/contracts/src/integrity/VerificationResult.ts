/**
 * Result Verification Output — V1
 *
 * ENTERPRISE AUDIT CONTRACT
 */
export interface VerificationResultV1 {
  valid: boolean;
  expectedHash: string;
  actualHash: string;
  algorithm: "sha256";
  verifiedAt: string;
}
