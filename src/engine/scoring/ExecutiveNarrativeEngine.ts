import { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";

export class ExecutiveNarrativeEngine {
  static generate(summary: EnterpriseRiskSummary): string {
    const drivers = summary.topRiskDrivers.join(", ");

    if (summary.severity === "Critical") {
      return `The enterprise exhibits a critical risk posture driven by ${drivers}. Immediate executive action is required to mitigate material exposure.`;
    }

    if (summary.severity === "High") {
      return `The organization faces elevated enterprise risk primarily due to ${drivers}. Strategic remediation should be prioritized to prevent escalation.`;
    }

    if (summary.severity === "Moderate") {
      return `Moderate enterprise risk has been identified, with contributing factors including ${drivers}. Continued monitoring and targeted controls are recommended.`;
    }

    return `The enterprise maintains a low overall risk profile with no material systemic concerns identified at this time.`;
  }
}
