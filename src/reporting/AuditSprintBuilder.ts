import type { AuditSprintInput, AuditSprintReport, RiskLevel } from "./AuditSprintSchema.js";

export class AuditSprintBuilder {
  static build(
    input: AuditSprintInput,
    decision: { severity: RiskLevel }
  ): AuditSprintReport {

    const narrative = `This organization is currently assessed at an overall risk level of ${decision.severity}. Based on the identified AI usage patterns, data sensitivity, and governance maturity, immediate actions are recommended to address the highest priority risks.`;

    return {
      meta: {
        companyName: input.company.name,
        generatedAt: new Date().toISOString(),
        overallRisk: decision.severity
      },
      summary: {
        narrative
      },
      findings: input.findings.map(f => ({
        id: f.id,
        severity: f.severity,
        description: f.description,
        recommendation: "Implement appropriate governance, controls, and monitoring."
      })),
      roadmap: [
        {
          priority: decision.severity,
          action: "Establish formal AI governance, risk management, and compliance oversight."
        }
      ]
    };
  }
}
