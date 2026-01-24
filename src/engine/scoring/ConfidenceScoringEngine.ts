import type { EvidenceItem, ConfidenceLevel, RiskLevel } from "../../reporting/ReportSchema.js";
import { EvidenceWeightingEngine } from "./EvidenceWeightingEngine.js";
import { ConfidenceScoringContext } from "./ConfidenceScoringContext.js";

export type ConfidenceScoreResult = {
  level: ConfidenceLevel;
  score: number;
  rationale: string;
};

export class ConfidenceScoringEngine {
  static score(
    evidenceItems: EvidenceItem[],
    severity: RiskLevel,
    context: ConfidenceScoringContext = new ConfidenceScoringContext()
  ): ConfidenceScoreResult {
    const evidenceCount = evidenceItems.length;

    if (evidenceCount === 0) {
      return {
        level: "Low",
        score: 0,
        rationale: "No evidence provided."
      };
    }

    const avgTrust = EvidenceWeightingEngine.averageWeight(evidenceItems);

    // Base trust score scaled to 0–100
    let score = avgTrust * 100;

    // --- Evidence Reuse Penalty (Progressive Decay) ---
    let reusePenalty = 1.0;

    for (const e of evidenceItems) {
      const key = `${e.source}|${e.trustLevel}|${e.artifactType}`;

      const usageCount = context.increment(key);

      const perUseFactor = 0.7; // aggressive decay
      reusePenalty *= Math.pow(perUseFactor, usageCount - 1);
    }

    // Floor to prevent annihilation
    reusePenalty = Math.max(0.3, reusePenalty);

    // Severity strictness factor
    const strictnessFactor =
      severity === "Critical" ? 0.75 :
      severity === "High" ? 0.85 :
      severity === "Moderate" ? 0.92 :
      1.0;

    score = score * strictnessFactor * reusePenalty;

    // Clamp
    score = Math.max(0, Math.min(100, Math.round(score)));

    const level: ConfidenceLevel =
      score >= 85 ? "Very High" :
      score >= 70 ? "High" :
      score >= 45 ? "Medium" :
      "Low";

    return {
      level,
      score,
      rationale: `Based on ${evidenceCount} evidence item(s), trust-weighted model, severity ${severity}, strictness x${strictnessFactor.toFixed(2)}, reusePenalty x${reusePenalty.toFixed(2)}`
    };
  }
}
