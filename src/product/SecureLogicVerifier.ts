import type { AuditSprintResultV1 } from "./contracts/result";
import type { VerificationResultV1 } from "./contracts/integrity/VerificationResult";
import { verifyResult } from "./integrity";

/**
 * SecureLogic Result Verifier
 * --------------------------
 * Read-only, auditor-safe verification surface
 */
export class SecureLogicVerifier {
  verify(result: AuditSprintResultV1): VerificationResultV1 {
    return verifyResult(result);
  }
}
