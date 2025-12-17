import { RiskSeverity, RISK_SEVERITY } from "../contracts/RiskSeverity";

export class RiskSeverityEngine {
  static fromScore(score: number): RiskSeverity {
    if (score >= 76) return RISK_SEVERITY.Critical;
    if (score >= 56) return RISK_SEVERITY.High;
    if (score >= 31) return RISK_SEVERITY.Moderate;
    return RISK_SEVERITY.Low;
  }
}
