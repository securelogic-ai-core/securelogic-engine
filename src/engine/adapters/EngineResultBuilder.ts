import { EngineFinding } from "../contracts/EngineResult";

export function buildEngineResult(findings: EngineFinding[]) {
  const severityOrder = { Low: 1, Moderate: 2, High: 3, Critical: 4 };

  const severityBreakdown = {
    Low: 0,
    Moderate: 0,
    High: 0,
    Critical: 0
  };

  findings.forEach(f => {
    severityBreakdown[f.severity] += 1;
  });

  const highest = findings.sort(
    (a, b) => severityOrder[b.severity] - severityOrder[a.severity]
  )[0];

  return {
    overallRiskLevel: highest ? highest.severity : "None",
    findings,
    severityBreakdown,
    recommendedSprint: "Remediation",
    monetizationSignal: {
      urgency: highest ? highest.severity : "None",
      estimatedDealValue: 25000
    }
  };
}
