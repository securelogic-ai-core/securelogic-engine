import type { AuditSprintResultV1 } from "../contracts/result";
import type { ResultSignatureV1 } from "../contracts/signature/ResultSignature";

/**
 * Attaches a signature without invalidating integrity
 */
export function attachSignature(
  result: AuditSprintResultV1,
  signature: ResultSignatureV1
): AuditSprintResultV1 {
  return {
    ...result,
    signature
  };
}
