import type { RiskLevel } from "./RiskLevel.js";

export type OverallRiskSummary = {
  severity: RiskLevel;
  rationale: string;
  drivers: string[];
};
