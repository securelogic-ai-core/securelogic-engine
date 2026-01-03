import type {
  RiskDecision,
  RiskLevel,
  ApprovalStatus,
  HeatMapPoint,
  RemediationDecision
} from "../contracts/RiskDecision.js";

import type {
  EnterpriseRiskSummary,
  DomainRiskScore,
  RemediationAction
} from "../engine/contracts/EnterpriseRiskSummary.js";

export class RiskDecisionEngine {
  static generate(summary: EnterpriseRiskSummary): RiskDecision {
    const score = summary.enterpriseRiskScore;

    const level: RiskLevel =
      score >= 76 ? "Critical" :
      score >= 56 ? "High" :
      score >= 31 ? "Moderate" :
      "Low";

    const approvalStatus: ApprovalStatus =
      level === "Low"
        ? "Approved"
        : level === "Moderate"
        ? "Conditional"
        : "Rejected";

    const heatMap: HeatMapPoint[] = summary.domainScores.map(
      (d: DomainRiskScore): HeatMapPoint => ({
        domain: d.domain,
        impact: d.impact ?? 0,
        likelihood: d.likelihood ?? 0
      })
    );

    const remediationPlan: RemediationDecision[] =
      summary.recommendedActions.map(
        (a: RemediationAction): RemediationDecision => ({
          id: a.id,
          description: a.description,
          estimatedRiskReduction: a.estimatedRiskReduction,
          priority: a.priority
        })
      );

    return {
      score,
      level,

      dominantDomains: summary.topRiskDrivers,
      severityRationale: summary.severityRationale ?? [],

      heatMap,
      remediationPlan,

      approvalStatus
    };
  }
}
