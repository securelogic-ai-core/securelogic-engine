import type { RiskLevel } from "../../contracts/RiskLevel.js";
import type { DomainRiskProfileV2 } from "./DomainRiskAggregationEngineV2.js";

const SEVERITY_WEIGHT: Record<RiskLevel, number> = {
  Low: 10,
  Moderate: 35,
  High: 70,
  Critical: 95
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function scoreToSeverity(score: number): RiskLevel {
  if (score >= 85) return "Critical";
  if (score >= 65) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
}

export type OverallRiskSummaryV2 = {
  severity: RiskLevel;
  score: number;
  rationale: string;
  drivers: string[];
};

export class OverallRiskAggregationEngineV2 {
  static aggregate(domains: DomainRiskProfileV2[]): OverallRiskSummaryV2 {
    if (domains.length === 0) {
      return {
        severity: "Low",
        score: 0,
        rationale: "No domains present",
        drivers: []
      };
    }

    const sorted = [...domains].sort((a, b) => b.finalScore - a.finalScore);

    const top = sorted[0]!;

    let weightedSum = 0;
    let weightTotal = 0;

    const weights = [1.0, 0.6, 0.3];

    for (let i = 0; i < Math.min(sorted.length, 3); i++) {
      weightedSum += sorted[i]!.finalScore * weights[i]!;
      weightTotal += weights[i]!;
    }

    const finalScore = clamp(weightedSum / weightTotal, 0, 100);
    const severity = scoreToSeverity(finalScore);

    return {
      severity,
      score: Math.round(finalScore),
      rationale: `Overall risk driven primarily by ${top.domain}`,
      drivers: sorted.slice(0, 3).flatMap(d => d.drivers).slice(0, 5)
    };
  }
}
