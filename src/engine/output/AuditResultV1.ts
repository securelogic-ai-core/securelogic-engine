import type { RiskDecision } from "../contracts/RiskDecision.js";
import type { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary.js";

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
