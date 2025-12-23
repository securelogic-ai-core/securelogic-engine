import type { LicenseContext } from "./contracts/LicenseContext";
import type { AuditSprintResultV1 } from "./contracts/result";

/**
 * HARD LICENSE ENFORCEMENT
 */
export function enforceLicense(
  result: AuditSprintResultV1,
  license: LicenseContext
): AuditSprintResultV1 {
  if (license.tier === "Community") {
    return {
      ...result,
      remediationPlan: undefined,
      controlTraces: [],
      attestations: []
    };
  }

  if (license.tier === "Professional") {
    return {
      ...result,
      attestations: []
    };
  }

  return result;
}
