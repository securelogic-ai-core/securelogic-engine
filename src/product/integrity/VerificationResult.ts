import type { VerificationStatus } from "./VerificationStatus";

export interface VerificationResult {
  status: VerificationStatus;
  verifiedAt: string;
  details: string[];
}
