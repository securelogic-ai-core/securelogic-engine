import { RiskBreakdown } from "./RiskBreakdown";

export interface ScoringResult {
  generatedAt: string;
  engineVersion: string;
  risk: RiskBreakdown;
}
