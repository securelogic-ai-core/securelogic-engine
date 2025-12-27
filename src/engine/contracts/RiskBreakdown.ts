import type { RiskFinding } from "./RiskFinding";
import type { RiskLevel } from "./RiskLevel";

export interface RiskBreakdown {
  overallScore: number; // 0–100
  overallLevel: RiskLevel;
  findings: RiskFinding[];
}
