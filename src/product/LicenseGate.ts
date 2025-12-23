import type { LicenseContext } from "./contracts/LicenseContext";
import type { AuditSprintResultV1 } from "./contracts/result";
import { ENTITLEMENT_MATRIX } from "./contracts/entitlements/EntitlementMatrix";

/**
 * HARD FEATURE ENFORCEMENT
 * ------------------------
 * Removes non-entitled data from results.
 */
export function enforceLicense(
  result: AuditSprintResultV1,
  license: LicenseContext
): AuditSprintResultV1 {
  const entitlements = ENTITLEMENT_MATRIX[license.tier];

  return {
    ...result,
    executiveSummary: entitlements.executiveSummary
      ? result.executiveSummary
      : undefined,

    findings: entitlements.findings ? result.findings : [],

    remediationPlan: entitlements.remediationPlan
      ? result.remediationPlan
      : undefined,

    controlTraces: entitlements.controlTraces
      ? result.controlTraces
      : [],

    evidence: entitlements.evidence ? result.evidence : [],

    riskRollup: entitlements.riskRollup
      ? result.riskRollup
      : undefined,

    attestations: entitlements.attestations
      ? result.attestations
      : [],

    integrity: result.integrity // NEVER removed
  };
}
