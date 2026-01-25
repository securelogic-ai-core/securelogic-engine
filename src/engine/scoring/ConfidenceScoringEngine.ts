import type { EvidenceItem, ConfidenceLevel, RiskLevel } from "../../reporting/ReportSchema.js";
import { EvidenceWeightingEngine } from "./EvidenceWeightingEngine.js";
import { ConfidenceScoringContext } from "./ConfidenceScoringContext.js";

export type ConfidenceScoreExplanation = {
  model: "trust-weighted";
  inputs: {
    evidenceCount: number;
    severity: RiskLevel;
  };
  components: {
    avgTrust: number;
    strictnessFactor: number;
    reusePenalty: number;
  };
  rawScore: number;
  finalScore: number;
};

export type ConfidenceScoreResult = {
  level: ConfidenceLevel;
  score: number;
  rationale: string;
  __explain?: ConfidenceScoreExplanation;
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
        rationale: "No evidence provided.",
        __explain: {
          model: "trust-weighted",
          inputs: { evidenceCount: 0, severity },
          components: {
            avgTrust: 0,
            strictnessFactor: 0,
            reusePenalty: 0
          },
          rawScore: 0,
          finalScore: 0
        }
      };
    }

    const avgTrust = EvidenceWeightingEngine.averageWeight(evidenceItems);

    // Base trust score scaled to 0–100
    let rawScore = avgTrust * 100;

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

    rawScore = rawScore * strictnessFactor * reusePenalty;

    // Clamp
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    const level: ConfidenceLevel =
      finalScore >= 85 ? "Very High" :
      finalScore >= 70 ? "High" :
      finalScore >= 45 ? "Medium" :
      "Low";

    return {
      level,
      score: finalScore,
      rationale: `Based on ${evidenceCount} evidence item(s), trust-weighted model, severity ${severity}, strictness x${strictnessFactor.toFixed(2)}, reusePenalty x${reusePenalty.toFixed(2)}`,
      __explain: {
        model: "trust-weighted",
        inputs: {
          evidenceCount,
          severity
        },
        components: {
          avgTrust,
          strictnessFactor,
          reusePenalty
        },
        rawScore,
        finalScore
      }
    };
  }
}
