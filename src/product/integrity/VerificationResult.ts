import type { VerificationReason } from "./VerificationReason";
import type { VerificationReceiptV1 } from "../contracts";

export interface VerificationResult {
  valid: boolean;
  reason: VerificationReason;
  receipt: VerificationReceiptV1;
  receiptHash: string;
  mode: string;
}
