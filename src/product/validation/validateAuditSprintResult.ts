import type { AuditSprintResultV1 } from "../contracts/result";

/**
 * Runtime validator for AuditSprintResultV1
 * ENTERPRISE SAFETY GATE
 */
export function validateAuditSprintResult(
  result: AuditSprintResultV1
): void {
  if (result.meta.version !== "audit-sprint-result-v1") {
    throw new Error("Invalid result version");
  }

  if (!result.executionContext) {
    throw new Error("Missing execution context");
  }

  if (!result.integrity || result.integrity.algorithm !== "sha256") {
    throw new Error("Invalid or missing integrity block");
  }

  if (!Array.isArray(result.findings)) {
    throw new Error("Findings must be an array");
  }

  if (!result.riskRollup) {
    throw new Error("Missing risk rollup");
  }

  if (!result.scoring) {
    throw new Error("Missing scoring output");
  }
}
