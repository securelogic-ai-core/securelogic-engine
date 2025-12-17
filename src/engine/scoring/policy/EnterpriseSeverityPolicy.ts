import { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary";

export interface PolicyDecisionTrace {
  policyId: string;
  description: string;
  triggered: boolean;
  inputs?: Record<string, unknown>;
  outcome?: string;
}

export interface SeverityDecision {
  finalSeverity: EnterpriseRiskSummary["severity"];
  rationale: string[];
  policyTrace?: PolicyDecisionTrace[];
}

export class EnterpriseSeverityPolicy {
  static evaluate(summary: EnterpriseRiskSummary): SeverityDecision {
    const rationale: string[] = [];
    const policyTrace: PolicyDecisionTrace[] = [];

    let finalSeverity: EnterpriseRiskSummary["severity"] = summary.severity;

    const governance = summary.categoryScores.find(
      c => c.category === "Governance"
    );

    if (governance && summary.overallScore > 0) {
      const share = governance.score / summary.overallScore;

      const triggered = share >= 0.3 && summary.overallScore >= 30;

      if (triggered) {
        finalSeverity = "High";
        rationale.push(
          "Governance risk exceeds 30% of total enterprise risk",
          "Enterprise severity escalated due to governance materiality"
        );
      }

      policyTrace.push({
        policyId: "ENT-GOV-001",
        description: "Governance materiality escalation",
        triggered,
        inputs: {
          governanceShare: share,
          governanceScore: governance.score,
          overallScore: summary.overallScore
        },
        outcome: triggered
          ? "Severity escalated to High"
          : "No escalation"
      });
    } else {
      policyTrace.push({
        policyId: "ENT-GOV-001",
        description: "Governance materiality escalation",
        triggered: false,
        inputs: {
          governancePresent: Boolean(governance),
          overallScore: summary.overallScore
        },
        outcome: "Insufficient inputs to evaluate"
      });
    }

    return { finalSeverity, rationale, policyTrace };
  }
}
