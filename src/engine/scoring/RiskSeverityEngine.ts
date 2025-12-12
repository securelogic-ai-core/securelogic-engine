import { RiskSeverity } from "../contracts/RiskSeverity";

export class RiskSeverityEngine {
  static fromScore(score: number): RiskSeverity {
    if (score >= 80) return "Critical";
    if (score >= 60) return "High";
    if (score >= 35) return "Moderate";
    return "Low";
  }
}
