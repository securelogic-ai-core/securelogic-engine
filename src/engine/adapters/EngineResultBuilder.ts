import { EngineFinding } from "../contracts/EngineResult";

export function buildEngineResult(findings: EngineFinding[]) {
  const severityBreakdown = {
    Low: 0,
    Moderate: 0,
    High: 0,
    Critical: 0
  };

  for (const f of findings) {
    severityBreakdown[f.severity]++;
  }

  const overallRiskLevel =
    severityBreakdown.Critical > 0
      ? "Critical"
      : severityBreakdown.High > 0
      ? "High"
      : severityBreakdown.Moderate > 0
      ? "Moderate"
      : "Low";

  const monetizationSignal = {
    urgency: overallRiskLevel === "High" || overallRiskLevel === "Critical" ? "High" : "Medium",
    estimatedDealValue:
      overallRiskLevel === "Critical"
        ? 75000
        : overallRiskLevel === "High"
        ? 25000
        : overallRiskLevel === "Moderate"
        ? 10000
        : 2500
  };

  return {
    overallRiskLevel,
    findings,
    severityBreakdown,
    recommendedSprint: overallRiskLevel === "Low" ? "Advisory" : "Remediation",
    monetizationSignal
  };
}
