import { EnterpriseEscalationPolicy } from "./scoring/policy/EnterpriseEscalationPolicy.js";

export type EnterpriseRiskSummary = {
  severity: "Low" | "Medium" | "High" | "Critical";
};

export class RunnerEngine {
  static run(severities: EnterpriseRiskSummary[]): EnterpriseRiskSummary {
    const finalSeverity = EnterpriseEscalationPolicy.escalate(
      severities.map(s => s.severity)
    );

    return {
      severity: finalSeverity
    };
  }
}
