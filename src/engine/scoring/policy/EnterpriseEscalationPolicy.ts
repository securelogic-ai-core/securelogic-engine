export type RiskSeverity = "Low" | "Medium" | "High" | "Critical";

export class EnterpriseEscalationPolicy {
  static escalate(severities: RiskSeverity[]): RiskSeverity {
    if (severities.includes("Critical")) return "Critical";
    if (severities.includes("High")) return "High";
    if (severities.includes("Medium")) return "Medium";
    return "Low";
  }
}
