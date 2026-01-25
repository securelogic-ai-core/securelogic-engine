import type { DomainRiskProfile } from "./DomainRiskAggregationEngine.js";
import type { OverallRiskSummary } from "../contracts/OverallRiskSummary.js";

const EXPLAIN_MODE = process.env.SECURELOGIC_EXPLAIN === "1";

export class OverallRiskAggregationEngine {
  static aggregate(profiles: DomainRiskProfile[]): OverallRiskSummary {
    if (profiles.length === 0) {
      const empty: OverallRiskSummary & { __explain?: any } = {
        severity: "Low",
        rationale: "No risk domains present",
        drivers: []
      };

      if (EXPLAIN_MODE) {
        empty.__explain = {
          reason: "No domains provided"
        };
      }

      return empty;
    }

    // Sort by finalScore descending (v1 contract behavior)
    const sorted = [...profiles].sort((a, b) => b.finalScore - a.finalScore);

    const top = sorted[0]!;

    // v1: take top 3 domains by score
    const drivers = sorted.slice(0, 3).map(p => p.domain);

    const result: OverallRiskSummary & { __explain?: any } = {
      severity: top.severity,
      rationale: `Overall risk driven by: ${drivers.join(", ")}`,
      drivers
    };

    // Hidden explain block (does not affect prod outputs)
    if (EXPLAIN_MODE) {
      result.__explain = {
        rule: "Sort domains by finalScore desc, pick top as severity, top 3 as drivers",
        inputs: profiles.map(p => ({
          domain: p.domain,
          finalScore: p.finalScore,
          severity: p.severity
        })),
        sorted: sorted.map(p => ({
          domain: p.domain,
          finalScore: p.finalScore,
          severity: p.severity
        })),
        chosen: {
          topDomain: top.domain,
          topSeverity: top.severity,
          drivers
        }
      };
    }

    return result;
  }
}
