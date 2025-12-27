import type { RiskDecision } from "../contracts/RiskDecision";
import type { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";

export interface AuditMetadata {
  auditId: string;
  generatedAt: string;
  engineVersion: string;
}

export interface AuditResultV1 {
  version: "v1";

  metadata: AuditMetadata;

  enterpriseSummary: EnterpriseRiskSummary;

  riskDecision: RiskDecision;
}
