import { DEFAULT_SCORING_POLICY } from "../../policy/defaultScoringPolicy.js";
import type { ScoringPolicy } from "../../policy/ScoringPolicy.js";

import type { Finding } from "../../../reporting/ReportSchema.js";
import type { RiskLevel } from "../../contracts/RiskLevel.js";
import type { EngineInput } from "../../contracts/EngineInput.js";

export type DomainRiskProfileV2 = {
  domain: string;
  severity: RiskLevel;
  findingCount: number;
  maxSeverity: RiskLevel;
  baseScore: number;
  normalizedScore: number;   // 0–100
  contextMultiplier: number;
  finalScore: number;        // 0–100
  drivers: string[];
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

export class DomainRiskAggregationEngineV2 {
  static aggregate(
    findings: Finding[],
    context: EngineInput["context"]
  ): DomainRiskProfileV2[] {
    const policy: ScoringPolicy = DEFAULT_SCORING_POLICY;

    const byDomain = new Map<string, Finding[]>();

    for (const f of findings) {
      if (!byDomain.has(f.domain)) byDomain.set(f.domain, []);
      byDomain.get(f.domain)!.push(f);
    }

    // --- Context multiplier ---
    let contextMultiplier = 1.0;

    if (context?.regulated) contextMultiplier += policy.contextMultipliers.regulated;
    if (context?.safetyCritical) contextMultiplier += policy.contextMultipliers.safetyCritical;
    if (context?.handlesPII) contextMultiplier += policy.contextMultipliers.handlesPII;

    if (context?.scale === "Enterprise") contextMultiplier += policy.contextMultipliers.scale.Enterprise;
    else if (context?.scale === "Medium") contextMultiplier += policy.contextMultipliers.scale.Medium;
    else if (context?.scale === "Small") contextMultiplier += policy.contextMultipliers.scale.Small;

    const results: DomainRiskProfileV2[] = [];

    for (const [domain, domainFindings] of byDomain.entries()) {
      let maxWeight = 0;

      for (const f of domainFindings) {
        const w = policy.severityWeights[f.severity];
        if (w > maxWeight) maxWeight = w;
      }

      // --- Base score: peak risk + accumulation ---
      const accumulationFactor = Math.log2(domainFindings.length + 1);
      const accumulationBoost = Math.min(
        accumulationFactor * policy.accumulation.perFindingBoost,
        policy.accumulation.maxBoost
      );

      const baseScore = maxWeight + accumulationBoost;

      const normalizedBase = clamp(baseScore, 0, 100);
      const finalScore = clamp(normalizedBase * contextMultiplier, 0, 100);

      const severity = scoreToSeverity(finalScore);

      results.push({
        domain,
        severity,
        findingCount: domainFindings.length,
        maxSeverity: scoreToSeverity(maxWeight),
        baseScore: Math.round(normalizedBase),
        normalizedScore: Math.round(normalizedBase),
        contextMultiplier: Number(contextMultiplier.toFixed(2)),
        finalScore: Math.round(finalScore),
        drivers: domainFindings.map(f => f.title)
      });
    }

    return results.sort((a, b) => b.finalScore - a.finalScore);
  }
}
