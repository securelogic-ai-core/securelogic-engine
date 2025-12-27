import type { AuditResultV1 } from "./AuditResultV1";
import type { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";
import type { RiskDecision } from "../contracts/RiskDecision";

export class AuditResultBuilder {
  static build(params: {
    auditId: string;
    engineVersion: string;
    summary: EnterpriseRiskSummary;
    decision: RiskDecision;
  }): AuditResultV1 {
    return {
      version: "v1",
      metadata: {
        auditId: params.auditId,
        generatedAt: new Date().toISOString(),
        engineVersion: params.engineVersion
      },
      enterpriseSummary: params.summary,
      riskDecision: params.decision
    };
  }
}
