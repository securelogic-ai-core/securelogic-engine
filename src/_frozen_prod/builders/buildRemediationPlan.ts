import type { ScoringOutputV1 } from "../../engine/contracts/scoring";
import type { RemediationPlan } from "../contracts/output";

/**
 * Builds a remediation plan from scoring output.
 * Enterprise-safe: handles licensed or redacted outputs.
 */
export function buildRemediationPlan(
  scoring: ScoringOutputV1
): RemediationPlan {
  const domainScores = scoring.domainScores ?? [];

  return {
    summary: "Prioritized remediation based on risk exposure.",
    steps: domainScores.map((d, idx) => ({
      id: `R-${idx + 1}`,
      description: `Improve controls in ${d.domain}`,
      priority: d.score > 70 ? "High" : "Medium"
    }))
  };
}
