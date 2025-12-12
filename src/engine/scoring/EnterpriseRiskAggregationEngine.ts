import { RiskScore } from "../contracts/RiskScore";
import { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";
import { RiskSeverityEngine } from "./RiskSeverityEngine";
import { ControlRegistry } from "../registry/ControlRegistry";

export class EnterpriseRiskAggregationEngine {
  static aggregate(scores: RiskScore[]): EnterpriseRiskSummary {
    const categoryTotals: Record<string, number> = {};
    const drivers = new Set<string>();

    for (const score of scores) {
      const definition = Object.values(ControlRegistry.controls)
        .find(c => c.id === score.controlId);

      const category = definition?.domain ?? "Unknown";

      categoryTotals[category] =
        (categoryTotals[category] ?? 0) + score.totalRiskScore;

      score.drivers.forEach(d => drivers.add(d));
    }

    const overallScore = Object.values(categoryTotals)
      .reduce((a, b) => a + b, 0);

    return {
      overallScore,
      severity: RiskSeverityEngine.fromScore(overallScore),
      categoryScores: Object.entries(categoryTotals).map(
        ([category, score]) => ({
          category,
          score,
          severity: RiskSeverityEngine.fromScore(score)
        })
      ),
      topRiskDrivers: Array.from(drivers).slice(0, 5)
    };
  }
}
