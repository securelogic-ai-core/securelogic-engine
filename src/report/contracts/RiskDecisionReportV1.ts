import type { RiskDecision } from "../../engine/contracts/RiskDecision.js";

export interface RiskDecisionReportV1 {
  reportVersion: "1.0";
  generatedAt: string;

  assessment: {
    name: string;
    date: string;
  };

  decision: RiskDecision;
}
