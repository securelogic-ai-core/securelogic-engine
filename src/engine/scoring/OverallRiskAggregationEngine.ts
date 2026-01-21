import type { RiskLevel } from "../../reporting/ReportSchema.js";
import type { DomainRiskProfile } from "./DomainRiskAggregationEngine.js";

export class OverallRiskAggregationEngine {
  static aggregate(domains: DomainRiskProfile[]): {
    severity: RiskLevel;
    drivers: string[];
  } {
    if (domains.length === 0) {
      return { severity: "Low", drivers: [] };
    }

    const sorted = [...domains].sort((a, b) => b.finalScore - a.finalScore);
    const top = sorted[0];

    return {
      severity: top.severity,
      drivers: sorted.slice(0, 3).map(d => d.domain)
    };
  }
}
