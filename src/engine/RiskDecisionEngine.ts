import { RiskDecision, RiskLevel } from "../contracts/RiskDecision";
import { EnterpriseRiskSummary } from "./contracts/EnterpriseRiskSummary";

export class RiskDecisionEngine {
  static generate(summary: EnterpriseRiskSummary): RiskDecision {
    const score = summary.enterpriseRiskScore;

    const level: RiskLevel =
      score >= 76 ? "Critical" :
      score >= 56 ? "High" :
      score >= 31 ? "Moderate" :
      "Low";

    const approvalStatus =
      level === "Low"
        ? "Approved"
        : level === "Moderate"
        ? "Conditional"
        : "Rejected";

    return {
      score,
      level,

      dominantDomains: summary.topRiskDrivers,
      severityRationale: summary.severityRationale,

      heatMap: summary.domainScores.map(d => ({
        domain: d.domain,
        impact: d.impact ?? 0,
        likelihood: d.likelihood ?? 0
      })),

      remediationPlan: summary.recommendedActions.map(a => ({
        id: a.id,
        description: a.description,
        estimatedRiskReduction: a.estimatedRiskReduction,
        priority: a.priority
      })),

      approvalStatus
    };
  }
}
