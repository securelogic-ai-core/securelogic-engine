import { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary";

export interface SeverityDecision {
  finalSeverity: EnterpriseRiskSummary["severity"];
  rationale: string[];
}

export class EnterpriseSeverityPolicy {
  static evaluate(summary: EnterpriseRiskSummary): SeverityDecision {
    const rationale: string[] = [];
    let finalSeverity = summary.severity;

    const governance = summary.categoryScores.find(
      c => c.category === "Governance"
    );

    if (governance && summary.overallScore > 0) {
      const share = governance.score / summary.overallScore;

      if (share >= 0.3 && summary.overallScore >= 30) {
        finalSeverity = "High";
        rationale.push(
          "Governance risk exceeds 30% of total enterprise risk",
          "Enterprise severity escalated due to governance materiality"
        );
      }
    }

    return { finalSeverity, rationale };
  }
}
