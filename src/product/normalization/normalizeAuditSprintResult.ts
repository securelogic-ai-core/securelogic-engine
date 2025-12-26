import type { AuditSprintResultV1 } from "../contracts";

/**
 * Ensures runtime shape matches contract expectations
 * AFTER entitlement gating and BEFORE envelope creation.
 */
export function normalizeAuditSprintResult(
  result: AuditSprintResultV1
): AuditSprintResultV1 {
  return {
    ...result,
    domains: result.domains ?? [],
    findings: result.findings ?? []
  };
}
