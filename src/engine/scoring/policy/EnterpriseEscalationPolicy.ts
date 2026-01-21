import type { RiskSeverity } from "../../contracts/RiskSeverity.js";

export class EnterpriseEscalationPolicy {
  static escalate(severities: RiskSeverity[]): RiskSeverity {
    if (severities.includes("Critical")) return "Critical";
    if (severities.includes("High")) return "High";
    if (severities.includes("Moderate")) return "Moderate";
    return "Low";
  }
}
