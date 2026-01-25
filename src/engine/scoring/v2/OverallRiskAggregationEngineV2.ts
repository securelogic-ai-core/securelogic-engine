import type { RiskLevel } from "../../contracts/RiskLevel.js";
import type { DomainRiskProfileV2 } from "./DomainRiskAggregationEngineV2.js";

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
  driversByDomain: Record<string, string[]>;
  __explain?: {
    rule: string;
    inputs: {
      domains: {
        domain: string;
        finalScore: number;
        severity: RiskLevel;
      }[];
    };
    weights: number[];
    calculation: {
      weightedSum: number;
      weightTotal: number;
      rawScore: number;
      finalScore: number;
    };
    chosen: {
      topDomain: string;
      topSeverity: RiskLevel;
      driversByDomain: Record<string, string[]>;
    };
  };
};

const EXPLAIN_MODE = process.env.SECURELOGIC_EXPLAIN === "1";

export class OverallRiskAggregationEngineV2 {
  static aggregate(domains: DomainRiskProfileV2[]): OverallRiskSummaryV2 {
    if (domains.length === 0) {
      const empty: OverallRiskSummaryV2 = {
        severity: "Low",
        score: 0,
        rationale: "No domains present",
        driversByDomain: {}
      };

      if (EXPLAIN_MODE) {
        (empty as any).__explain = {
          reason: "No domains provided"
        };
      }

      return empty;
    }

    const sorted = [...domains].sort((a, b) => b.finalScore - a.finalScore);
    const top = sorted[0]!;

    const weights = [1.0, 0.6, 0.3];
    let weightedSum = 0;
    let weightTotal = 0;

    for (let i = 0; i < Math.min(sorted.length, 3); i++) {
      weightedSum += sorted[i]!.finalScore * weights[i]!;
      weightTotal += weights[i]!;
    }

    const rawScore = weightedSum / weightTotal;
    const finalScore = clamp(rawScore, 0, 100);
    const severity = scoreToSeverity(finalScore);

    const driversByDomain: Record<string, string[]> = {};

    for (const domain of sorted.slice(0, 3)) {
      if (domain.drivers.length > 0) {
        driversByDomain[domain.domain] = [...domain.drivers];
      }
    }

    const result: OverallRiskSummaryV2 = {
      severity,
      score: Math.round(finalScore),
      rationale: `Overall risk driven primarily by ${top.domain}`,
      driversByDomain
    };

    // Hidden explain block
    if (EXPLAIN_MODE) {
      (result as any).__explain = {
        rule: "Weighted average of top 3 domains (weights 1.0, 0.6, 0.3), then map to severity",
        inputs: {
          domains: sorted.map(d => ({
            domain: d.domain,
            finalScore: d.finalScore,
            severity: d.severity
          }))
        },
        weights,
        calculation: {
          weightedSum,
          weightTotal,
          rawScore,
          finalScore
        },
        chosen: {
          topDomain: top.domain,
          topSeverity: top.severity,
          driversByDomain
        }
      };
    }

    return result;
  }
}
