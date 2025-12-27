import type { RiskDecision } from "../../engine/contracts/RiskDecision";

export interface RiskDecisionReportInput {
  clientName: string;
  assessmentDate: string;
  decision: RiskDecision;
  preparedBy: string;
  disclaimer?: string;
}
