import type { RiskPattern } from "../patterns/RiskPattern.js";
import type { IssueBrief } from "./IssueBrief.js";

export async function generateIssueBrief(
  issueNumber: number,
  pattern: RiskPattern
): Promise<IssueBrief> {
  return {
    issueNumber,
    title: `Issue #${issueNumber} — ${pattern.title}`,
    executiveSummary: `
A systemic governance failure disrupted mission-critical operations.
This was not a tooling failure.
This was a risk visibility failure.
`,
    domains: pattern.domains,
    riskTable: pattern.domains.map(d => ({
      domain: d,
      rating: "CRITICAL"
    })),
    confidence: "HIGH",
    publishedAt: new Date().toISOString()
  };
}
