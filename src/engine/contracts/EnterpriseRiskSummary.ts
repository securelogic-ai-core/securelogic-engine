import { RiskSeverity } from "./RiskSeverity";

export interface EnterpriseRiskSummary {
  overallScore: number;
  severity: RiskSeverity;

  categoryScores: {
    category: string;
    score: number;
    severity: RiskSeverity;
  }[];

  topRiskDrivers: string[];
}
