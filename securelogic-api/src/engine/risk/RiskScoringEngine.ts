// src/engine/risk/RiskScoringEngine.ts

export type Severity = "Low" | "Medium" | "High" | "Critical";

export interface FindingInput {
  id: string;
  severity: Severity;
  confidence: number; // 0–100
  domain: string;
}

export interface RiskScoreResult {
  overallScore: number; // 0–100
  level: Severity;
  domainBreakdown: Record<string, number>;
  severityCounts: Record<Severity, number>;
  weightedScore: number;
}

const SEVERITY_WEIGHTS: Record<Severity, number> = {
  Low: 1,
  Medium: 3,
  High: 7,
  Critical: 10,
};

export class RiskScoringEngine {
  static score(findings: FindingInput[]): RiskScoreResult {
    if (findings.length === 0) {
      return {
        overallScore: 0,
        weightedScore: 0,
        level: "Low",
        domainBreakdown: {},
        severityCounts: { Low: 0, Medium: 0, High: 0, Critical: 0 },
      };
    }

    let totalWeighted = 0;
    let maxPossible = 0;

    const domainBreakdown: Record<string, number> = {};
    const severityCounts: Record<Severity, number> = {
      Low: 0,
      Medium: 0,
      High: 0,
      Critical: 0,
    };

    for (const f of findings) {
      const severityWeight = SEVERITY_WEIGHTS[f.severity];
      const confidenceFactor = Math.min(Math.max(f.confidence, 0), 100) / 100;

      const weighted = severityWeight * confidenceFactor;

      totalWeighted += weighted;
      maxPossible += severityWeight;

      severityCounts[f.severity]++;

      if (!domainBreakdown[f.domain]) {
        domainBreakdown[f.domain] = 0;
      }
      domainBreakdown[f.domain] += weighted;
    }

    const normalizedScore = Math.round((totalWeighted / maxPossible) * 100);

    return {
      overallScore: normalizedScore,
      weightedScore: Number(totalWeighted.toFixed(2)),
      level: RiskScoringEngine.scoreToLevel(normalizedScore),
      domainBreakdown,
      severityCounts,
    };
  }

  static scoreToLevel(score: number): Severity {
    if (score >= 75) return "Critical";
    if (score >= 50) return "High";
    if (score >= 25) return "Medium";
    return "Low";
  }
}
