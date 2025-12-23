import { RiskFinding } from "./RiskFinding";
import { RiskLevel } from "./RiskLevel";

export interface RiskBreakdown {
  overallScore: number; // 0–100
  overallLevel: RiskLevel;
  findings: RiskFinding[];
}
