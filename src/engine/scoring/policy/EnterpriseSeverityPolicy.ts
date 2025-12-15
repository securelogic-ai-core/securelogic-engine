import { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary";
import { RiskSeverity } from "../../contracts/RiskSeverity";

export interface SeverityDecision {
  finalSeverity: RiskSeverity;
  rationale: string[];
}

export class EnterpriseSeverityPolicy {
  static evaluate(summary: EnterpriseRiskSummary): SeverityDecision {
    const rationale: string[] = [];
    let finalSeverity: RiskSeverity = summary.severity;

    const governance = summary.categoryScores.find(
      c => c.category === "Governance"
    );

    if (governance && summary.overallScore > 0) {
      const share = governance.score / summary.overallScore;

      if (share >= 0.3 && summary.overallScore >= 30) {
        finalSeverity = RiskSeverity.High;
        rationale.push(
          "Governance risk exceeds 30% of total enterprise risk",
          "Enterprise severity escalated due to governance materiality"
        );
      }
    }

    return { finalSeverity, rationale };
  }
}
