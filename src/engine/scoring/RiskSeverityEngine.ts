import { RiskSeverity } from "../contracts/RiskSeverity";

export class RiskSeverityEngine {
  static fromScore(score: number): RiskSeverity {
    if (score >= 76) return RiskSeverity.Critical;
    if (score >= 56) return RiskSeverity.High;
    if (score >= 31) return RiskSeverity.Moderate;
    return RiskSeverity.Low;
  }
}
