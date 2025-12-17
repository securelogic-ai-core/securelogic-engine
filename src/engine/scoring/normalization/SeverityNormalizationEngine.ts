import { RiskSeverity, RISK_SEVERITY } from "../../contracts/RiskSeverity";

/**
 * Single source of truth for severity escalation and normalization.
 * No engine or policy may assign severity directly.
 */
export class SeverityNormalizationEngine {
  static normalize(input: unknown): RiskSeverity {
    switch (input) {
      case RISK_SEVERITY.Critical:
      case "Critical":
        return RISK_SEVERITY.Critical;

      case RISK_SEVERITY.High:
      case "High":
        return RISK_SEVERITY.High;

      case RISK_SEVERITY.Moderate:
      case "Moderate":
        return RISK_SEVERITY.Moderate;

      case RISK_SEVERITY.Low:
      case "Low":
      default:
        return RISK_SEVERITY.Low;
    }
  }

  static escalate(
    current: RiskSeverity,
    target: RiskSeverity
  ): RiskSeverity {
    const order: RiskSeverity[] = [
      RISK_SEVERITY.Low,
      RISK_SEVERITY.Moderate,
      RISK_SEVERITY.High,
      RISK_SEVERITY.Critical
    ];

    return order.indexOf(target) > order.indexOf(current)
      ? target
      : current;
  }
}