import type { AuditSprintResultV1 } from "../contracts";

/**
 * Validates that an object conforms to AuditSprintResultV1
 * BEFORE envelope creation.
 */
export function validateAuditSprintResult(
  input: unknown
): AuditSprintResultV1 {
  if (typeof input !== "object" || input === null) {
    throw new Error("AuditSprintResult must be an object");
  }

  const candidate = input as Partial<AuditSprintResultV1>;

  if (
    candidate.kind !== "audit-sprint-result" ||
    candidate.version !== "audit-sprint-result-v1"
  ) {
    throw new Error("Invalid AuditSprintResult identity");
  }

  if (!candidate.domains || !Array.isArray(candidate.domains)) {
    throw new Error("AuditSprintResult.domains must be an array");
  }

  if (!candidate.findings || !Array.isArray(candidate.findings)) {
    throw new Error("AuditSprintResult.findings must be an array");
  }

  if (!candidate.summary || typeof candidate.summary !== "object") {
    throw new Error("AuditSprintResult.summary must be an object");
  }

  return candidate as AuditSprintResultV1;
}
