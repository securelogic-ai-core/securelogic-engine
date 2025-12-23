import type { ScoringOutputV1 } from "../engine/contracts/scoring";
import type { LicenseContext } from "./contracts/LicenseContext";
import { LICENSE_ENTITLEMENTS } from "./contracts/LicenseEntitlements";

/**
 * Enforces license constraints on scoring output.
 * ENTERPRISE SAFE — respects exactOptionalPropertyTypes
 */
export function enforceScoringLicense(
  output: ScoringOutputV1,
  license: LicenseContext
): Partial<ScoringOutputV1> {
  const entitlements = LICENSE_ENTITLEMENTS[license.tier];

  return {
    version: output.version,
    overallRiskScore: output.overallRiskScore,
    orgProfile: output.orgProfile,
    generatedAt: output.generatedAt,
    ...(entitlements.domainBreakdown && {
      domainScores: output.domainScores
    })
  };
}