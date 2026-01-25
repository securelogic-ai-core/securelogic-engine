import type { Finding, RiskLevel } from "../../reporting/ReportSchema.js";
import { computeContextFactor } from "./ContextRiskWeights.js";
import type { EngineInput } from "../contracts/EngineInput.js";

const WEIGHTS: Record<RiskLevel, number> = {
  Critical: 90,
  High: 60,
  Moderate: 35,
  Low: 10
};

function scoreToRisk(score: number): RiskLevel {
  if (score >= 85) return "Critical";
  if (score >= 60) return "High";
  if (score >= 35) return "Moderate";
  return "Low";
}

export type DomainRiskProfile = {
  domain: string;
  severity: RiskLevel;
  findingCount: number;
  baseScore: number;
  finalScore: number;
  contextFactor: number;
  drivers: string[];
  __explain?: {
    inputs: {
      findingIds: string[];
      severities: RiskLevel[];
      contextFactor: number;
    };
    components: {
      maxWeight: number;
      densityBoost: number;
    };
    calculation: {
      baseScore: number;
      finalScore: number;
    };
    rule: "max(severityWeight) + densityBoost, then * (1 + contextFactor)";
  };
};

const EXPLAIN_MODE = process.env.SECURELOGIC_EXPLAIN === "1";

export class DomainRiskAggregationEngine {
  static aggregate(findings: Finding[], context: EngineInput["context"]): DomainRiskProfile[] {
    const byDomain = new Map<string, Finding[]>();

    for (const f of findings) {
      if (!byDomain.has(f.domain)) byDomain.set(f.domain, []);
      byDomain.get(f.domain)!.push(f);
    }

    const contextFactor = computeContextFactor(context);
    const results: DomainRiskProfile[] = [];

    for (const [domain, domainFindings] of byDomain.entries()) {
      const maxWeight = Math.max(...domainFindings.map(f => WEIGHTS[f.severity]));
      const densityBoost = Math.log(domainFindings.length + 1) * 10;

      const baseScoreRaw = maxWeight + densityBoost;
      const finalScoreRaw = baseScoreRaw * (1 + contextFactor);

      const baseScore = Math.round(baseScoreRaw);
      const finalScore = Math.round(finalScoreRaw);

      const profile: DomainRiskProfile = {
        domain,
        severity: scoreToRisk(finalScore),
        findingCount: domainFindings.length,
        baseScore,
        finalScore,
        contextFactor,
        drivers: [domain]
      };

      // Hidden explain block (does not affect prod outputs)
      if (EXPLAIN_MODE) {
        profile.__explain = {
          inputs: {
            findingIds: domainFindings.map(f => f.id),
            severities: domainFindings.map(f => f.severity),
            contextFactor
          },
          components: {
            maxWeight,
            densityBoost
          },
          calculation: {
            baseScore: baseScoreRaw,
            finalScore: finalScoreRaw
          },
          rule: "max(severityWeight) + densityBoost, then * (1 + contextFactor)"
        };
      }

      results.push(profile);
    }

    return results;
  }
}
