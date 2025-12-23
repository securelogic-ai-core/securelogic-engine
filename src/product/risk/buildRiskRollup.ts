import type { FindingV1 } from "../contracts/finding";
import type { RiskRollupV1 } from "../contracts/risk";
import { SEVERITY_WEIGHTS } from "./severityWeights";

/**
 * Builds a board-level risk rollup from findings.
 */
export function buildRiskRollup(
  findings: FindingV1[]
): RiskRollupV1 {
  const counts = {
    Low: 0,
    Medium: 0,
    High: 0,
    Critical: 0
  };

  let totalScore = 0;

  for (const finding of findings) {
    counts[finding.severity]++;
    totalScore += SEVERITY_WEIGHTS[finding.severity];
  }

  const normalizedScore =
    findings.length === 0
      ? 0
      : Math.min(100, Math.round(totalScore / findings.length));

  const overallRisk =
    normalizedScore >= 80
      ? "Critical"
      : normalizedScore >= 60
      ? "High"
      : normalizedScore >= 30
      ? "Moderate"
      : "Low";

  return {
    overallRisk,
    numericScore: normalizedScore,
    findingCounts: counts,
    rationale:
      findings.length === 0
        ? "No material control weaknesses detected."
        : `Risk driven by ${counts.High + counts.Critical} high or critical findings.`
  };
}
