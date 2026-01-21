import type { EngineFinding, SeverityLevel, EngineResult } from "../contracts/EngineResult.js";

const severityOrder: Record<SeverityLevel, number> = {
  Low: 1,
  Moderate: 2,
  High: 3,
  Critical: 4
};

export function buildEngineResult(findings: EngineFinding[]): EngineResult {
  const severityBreakdown: Record<SeverityLevel, number> = {
    Low: 0,
    Moderate: 0,
    High: 0,
    Critical: 0
  };

  for (const f of findings) {
    severityBreakdown[f.severity]++;
  }

  const sorted = [...findings].sort(
    (a, b) => severityOrder[b.severity] - severityOrder[a.severity]
  );

  const overallRiskLevel =
    sorted.length === 0 ? "Low" : sorted[0]?.severity ?? "Low";

  return {
    overallRiskLevel,
    findings: sorted,
    severityBreakdown
  };
}
