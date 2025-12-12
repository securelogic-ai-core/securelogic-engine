import { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";

export class ExecutiveNarrativeEngine {
  static generate(summary: EnterpriseRiskSummary): string {
    const severityStatement =
      summary.severity === "Critical"
        ? "The organization is exposed to critical AI-related risks requiring immediate executive intervention."
        : summary.severity === "High"
        ? "The organization faces elevated AI risks that demand prioritized remediation."
        : summary.severity === "Moderate"
        ? "The organization maintains moderate AI risk exposure with targeted improvement opportunities."
        : "The organization demonstrates a generally controlled AI risk posture.";

    const drivers =
      summary.topRiskDrivers.length > 0
        ? `Key risk drivers include: ${summary.topRiskDrivers.join(", ")}.`
        : "No dominant systemic risk drivers were identified.";

    return `${severityStatement} ${drivers}`;
  }
}
