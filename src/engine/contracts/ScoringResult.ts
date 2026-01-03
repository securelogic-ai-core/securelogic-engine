import type { RiskBreakdown } from "./RiskBreakdown.js";

export interface ScoringResult {
  generatedAt: string;
  engineVersion: string;
  risk: RiskBreakdown;
}
