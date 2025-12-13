export type RiskSeverity = "Low" | "Moderate" | "High" | "Critical";

export class RiskSeverityEngine {
  static fromScore(score: number): RiskSeverity {
    if (score >= 60) return "Critical";
    if (score >= 40) return "High";
    if (score >= 20) return "Moderate";
    return "Low";
  }
}
