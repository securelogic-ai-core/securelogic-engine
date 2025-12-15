
import { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary";
import { RiskSeverity } from "../../contracts/RiskSeverity";

export class EnterpriseEscalationPolicy {
  static apply(summary: EnterpriseRiskSummary): EnterpriseRiskSummary {
    const exceptionCount = summary.topRiskDrivers.filter(
      d => d === "Unmitigated control exception"
    ).length;

    if (exceptionCount >= 2) {
      return {
        ...summary,
        severity:
          summary.severity === RiskSeverity.Critical
            ? RiskSeverity.Critical
            : RiskSeverity.High,
        severityRationale: [
          ...(summary.severityRationale ?? []),
          "Multiple unmitigated control exceptions triggered enterprise escalation"
        ]
      };
    }

    return summary;
  }
}