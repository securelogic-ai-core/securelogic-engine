import type { RiskScore } from "../contracts/RiskScore.js";
import type {
  EnterpriseRiskSummary,
  CategoryRiskScore,
  DomainRiskScore,
  RemediationAction
} from "../contracts/EnterpriseRiskSummary.js";
import { RiskSeverityEngine } from "./RiskSeverityEngine.js";
import { ControlRegistry } from "../registry/ControlRegistry.js";
import { DOMAIN_WEIGHTS } from "../policy/DomainWeightPolicy.js";

export class EnterpriseRiskAggregationEngine {
  static aggregate(scores: RiskScore[]): EnterpriseRiskSummary {
    const categoryTotals: Record<string, number> = {};
    const domainScores: DomainRiskScore[] = [];
    const drivers = new Set<string>();

    for (const score of scores) {
      const definition = Object.values(ControlRegistry.controls).find(
        c => c.id === score.controlId
      );

      const domain = definition?.domain ?? "Uncategorized";
      const weight = DOMAIN_WEIGHTS[domain] ?? 1.0;

      const weightedScore = score.totalRiskScore * weight;

      categoryTotals[domain] =
        (categoryTotals[domain] ?? 0) + weightedScore;

      score.drivers.forEach((d: string) => drivers.add(d));

      domainScores.push({
        domain,
        score: weightedScore,
        severity: RiskSeverityEngine.fromScore(weightedScore)
      });
    }

    const overallScore = Object.values(categoryTotals).reduce(
      (a: number, b: number) => a + b,
      0
    );

    const categoryScores: CategoryRiskScore[] =
      Object.entries(categoryTotals).map(
        ([category, score]): CategoryRiskScore => ({
          category,
          score,
          severity: RiskSeverityEngine.fromScore(score)
        })
      );

    const severity = RiskSeverityEngine.fromScore(overallScore);

    const recommendedActions: RemediationAction[] = [];

    return {
      overallScore,
      enterpriseRiskScore: overallScore,

      severity,

      domainScores,
      categoryScores,

      topRiskDrivers: Array.from(drivers).slice(0, 5),
      severityRationale: [],

      recommendedActions
    };
  }
}