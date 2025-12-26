import type { AuditSprintResultV1 } from "../contracts";
import type { Entitlements } from "./Entitlements";

/**
 * Enforces entitlements by REMOVING disallowed fields entirely.
 * Tests assert that gated fields DO NOT EXIST ("in" === false).
 */
export function enforceEntitlements(
  result: AuditSprintResultV1,
  entitlements: Entitlements
): AuditSprintResultV1 {
  const gated: any = { ...result };

  // CORE tier: strip all detailed artifacts
  if (!entitlements.allowFindings) {
    delete gated.domains;
    delete gated.findings;
    delete gated.remediationPlan;
    delete gated.controlTraces;
    delete gated.evidence;
    delete gated.attestations;
  }

  // Executive summary
  if (!entitlements.allowExecutiveSummary) {
    delete gated.summary;
  }

  // Integrity metadata
  if (!entitlements.allowIntegrity) {
    delete gated.integrity;
  }

  return gated as AuditSprintResultV1;
}
