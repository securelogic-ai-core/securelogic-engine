import type { DomainRiskProfile } from "./DomainRiskAggregationEngine.js";
import type { OverallRiskSummary } from "../contracts/OverallRiskSummary.js";

export class OverallRiskAggregationEngine {
  static aggregate(profiles: DomainRiskProfile[]): OverallRiskSummary {
    if (profiles.length === 0) {
      return {
        severity: "Low",
        rationale: "No risk domains present",
        drivers: []
      };
    }

    // Sort by finalScore descending (v1 contract behavior)
    const sorted = [...profiles].sort((a, b) => b.finalScore - a.finalScore);

    const top = sorted[0]!;

    // v1: take top 3 domains by score
    const drivers = sorted.slice(0, 3).map(p => p.domain);

    return {
      severity: top.severity,
      rationale: `Overall risk driven by: ${drivers.join(", ")}`,
      drivers
    };
  }
}
