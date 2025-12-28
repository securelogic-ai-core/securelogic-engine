import type { AuditSprintResultV1 } from "../contracts";

/**
 * Finalizes integrity metadata.
 * Must fully materialize integrity due to
 * exactOptionalPropertyTypes.
 */
export function finalizeAuditSprintResult(
  result: AuditSprintResultV1
): AuditSprintResultV1 {
  return {
    ...result,
    integrity: {
      algorithm: result.integrity?.algorithm ?? "sha256",
      hash: result.integrity?.hash ?? "pending",
      generatedAt: new Date().toISOString()
    }
  };
}
