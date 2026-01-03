import type { RiskFinding } from "./RiskFinding.js";
import type { RiskLevel } from "./RiskLevel.js";

export interface RiskBreakdown {
  overallScore: number; // 0–100
  overallLevel: RiskLevel;
  findings: RiskFinding[];
}
