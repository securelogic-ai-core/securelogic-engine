/**
 * IMMUTABLE AUDIT SPRINT RESULT — v1
 * Test-compatible + audit-defensible
 */
export type AuditSprintResultV1 = {
  version?: "v1";
  data?: unknown;

  kind?: "AUDIT_SPRINT_RESULT";

  meta?: {
    auditId?: string;
    generatedAt?: string;
    engineVersion?: string;
  };

  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
};
