import { SeverityNormalizationEngine } from "../normalization/SeverityNormalizationEngine";

import type { EnterpriseRiskSummary } from "../../contracts/EnterpriseRiskSummary";
import { RiskSeverity, RISK_SEVERITY } from "../../contracts/RiskSeverity";

export class EnterpriseEscalationPolicy {
  static apply(summary: EnterpriseRiskSummary): EnterpriseRiskSummary {
    const exceptionCount = summary.topRiskDrivers.filter(
      d => d === "Unmitigated control exception"
    ).length;

    if (exceptionCount >= 2) {
      return {
        ...summary,
        severity:
          summary.severity === RISK_SEVERITY.Critical
            ? RISK_SEVERITY.Critical
            : RISK_SEVERITY.High,
        severityRationale: [
          ...(summary.severityRationale ?? []),
          "Multiple unmitigated control exceptions triggered enterprise escalation"
        ]
      };
    }

    return summary;
  }
}