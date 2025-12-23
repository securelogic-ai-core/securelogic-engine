export function normalizeAuditSprintResult(result: any) {
  return {
    version: "v1",
    assessment: {
      name: "SecureLogic AI Audit Sprint"
    },
    executiveSummary: {
      narrative: result.executiveNarrative,
      enterpriseRiskScore: result.enterprise?.totalRiskScore ?? null,
      overallRisk: result.enterprise?.severity ?? "Unknown"
    },
    enterpriseOverview: result.enterprise ?? {},
    materialRisks: result.materiality?.materialRisks ?? [],
    disclaimers: [
      "This assessment represents a point-in-time evaluation.",
      "This report does not constitute legal or regulatory advice."
    ]
  };
}
