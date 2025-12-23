import type { ScoringOutputV1 } from "../../engine/contracts/scoring";
import type { ExecutiveSummary } from "../contracts/output";

export function buildExecutiveSummary(
  scoring: ScoringOutputV1
): ExecutiveSummary {
  const score = scoring.overallRiskScore;

  if (score >= 80) {
    return {
      headlineRisk: "Critical",
      rationale: "Multiple high-risk control failures detected.",
      keyDrivers: ["Control coverage gaps", "Policy non-compliance"]
    };
  }

  if (score >= 60) {
    return {
      headlineRisk: "High",
      rationale: "Significant weaknesses present across domains.",
      keyDrivers: ["Partial control implementation"]
    };
  }

  return {
    headlineRisk: "Moderate",
    rationale: "Risk present but largely contained.",
    keyDrivers: ["Minor control gaps"]
  };
}
