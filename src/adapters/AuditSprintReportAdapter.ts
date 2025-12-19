import { AuditSprintReportV1 } from "../contracts/AuditSprintReportV1";

export function adaptToAuditSprintReportV1(engineResult: any): AuditSprintReportV1 {
  return {
    version: "v1",

    assessment: {
      name: "Enterprise AI Risk Assessment",
      date: engineResult.assessmentDate
    },

    executiveSummary: {
      overallRisk: engineResult.enterprise.severity,
      enterpriseRiskScore: engineResult.enterprise.enterpriseRiskScore,
      approvalStatus: engineResult.enterprise.approvalStatus,
      narrative: engineResult.executiveNarrative
    },

    enterpriseOverview: {
      totalRiskScore: engineResult.enterprise.enterpriseRiskScore,
      severity: engineResult.enterprise.severity,
      topRiskDomains: engineResult.enterprise.domainScores
        .sort((a: any, b: any) => b.score - a.score)
        .map((d: any) => d.domain)
        .slice(0, 3)
    },

    materialRisks: engineResult.materiality.materialRisks,

    controlGaps: engineResult.controls.map((c: any) => ({
      controlId: c.controlId,
      domain: c.domain ?? "Unknown",
      issue: c.drivers.join(", ")
    })),

    recommendedActions: engineResult.enterprise.recommendedActions.map((a: any) => ({
      action: a.title ?? a.action,
      priority: a.priority,
      riskAddressed: a.risk
    })),

    disclaimers: [
      "This assessment represents a point-in-time evaluation.",
      "Results are based on information provided at the time of assessment.",
      "This report does not constitute a legal or regulatory guarantee."
    ]
  };
}
