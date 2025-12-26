import type { AuditSprintResultV1 } from "../contracts";
import type { Entitlements } from "./Entitlements";

/**
 * Enforces entitlements by REMOVING disallowed fields entirely.
 * Tests require properties to be ABSENT, not empty.
 */
export function enforceEntitlements(
  result: AuditSprintResultV1,
  entitlements: Entitlements
): AuditSprintResultV1 {
  const gated: any = { ...result };

  if (!entitlements.allowFindings) {
    delete gated.domains;
    delete gated.findings;
    delete gated.remediationPlan;
    delete gated.controlTraces;
    delete gated.evidence;
    delete gated.attestations;
  }

  if (!entitlements.allowExecutiveSummary) {
    delete gated.summary;
  }

  if (!entitlements.allowIntegrity) {
    delete gated.integrity;
  }

  return gated as AuditSprintResultV1;
}
