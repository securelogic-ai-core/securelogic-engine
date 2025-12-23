import type { AuditSprintResultV1 } from "./contracts/result";
import type { VerificationResultV1 } from "./contracts/integrity/VerificationResult";
import { verifyResult } from "./integrity";
import { migrateResult } from "./migration/migrateResult";

/**
 * SecureLogic Result Verifier
 * Enterprise-safe, backward compatible
 */
export class SecureLogicVerifier {
  verify(result: AuditSprintResultV1): VerificationResultV1 {
    const migrated = migrateResult(result);
    return verifyResult(migrated);
  }
}
