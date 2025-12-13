import { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary";

export class EnterpriseEscalationPolicy {
  static apply(summary: EnterpriseRiskSummary): EnterpriseRiskSummary {
    const exceptionCount = summary.topRiskDrivers.filter(
      d => d === "Unmitigated control exception"
    ).length;

    if (exceptionCount >= 2) {
      return {
        ...summary,
        severity: summary.severity === "Critical" ? "Critical" : "High",
        severityRationale: [
          ...(summary.severityRationale ?? []),
          "Multiple unmitigated control exceptions triggered enterprise escalation"
        ]
      };
    }

    return summary;
  }
}
