import { RiskScore } from "../contracts/RiskScore";
import { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";
import { RiskSeverityEngine } from "./RiskSeverityEngine";

export class EnterpriseRiskAggregationEngine {
  static aggregate(scores: RiskScore[]): EnterpriseRiskSummary {
    const categoryTotals: Record<string, number> = {};
    const drivers = new Set<string>();

    for (const score of scores) {
      categoryTotals[score.controlId] =
        (categoryTotals[score.controlId] ?? 0) + score.totalRiskScore;

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
