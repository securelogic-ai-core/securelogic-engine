/**
 * riskScore.ts — deterministic numeric scoring for the RISK REGISTER.
 *
 * Distinct from riskScoring.ts, which scores external SIGNALS against entities
 * (severity × entity-criticality × obligation-priority). This module scores a
 * risk row from its register axes: likelihood × impact → a 0–100 magnitude
 * used for ranking, the heatmap, and executive ordering.
 *
 * Methodology (ratified Option A — opinionated default, no per-org config):
 *
 *   score = round( likelihood_weight × impact_weight × 100 )
 *
 * The weights are fixed scales (not customer-configurable in v1). The residual
 * score — the ranking key — is persisted alongside its `score_basis` so the
 * headline number is fully explainable; inherent_score is persisted without a
 * basis (the residual axis pair is what drives ordering).
 *
 * Pure: no I/O, no DB. Fully unit-testable.
 */

/** Likelihood scale (register vocabulary: very_likely … rare). */
export const LIKELIHOOD_WEIGHTS: Record<string, number> = {
  very_likely: 1.0,
  likely: 0.8,
  possible: 0.6,
  unlikely: 0.4,
  rare: 0.2
};

/**
 * Impact scale. Impact uses the same PascalCase vocabulary as severity
 * (Critical/High/Moderate/Low); these weights mirror the signal-scoring
 * severity defaults so the two surfaces read consistently.
 */
export const IMPACT_WEIGHTS: Record<string, number> = {
  Critical: 1.0,
  High: 0.75,
  Moderate: 0.5,
  Low: 0.25
};

/** Band thresholds on the 0–100 score, mapped to the existing rating strings. */
export type ScoreBand = "Critical" | "High" | "Moderate" | "Low";

export type RiskScoreBasis = {
  likelihood_weight: number;
  impact_weight: number;
};

export type RiskScoreResult = {
  score: number; // integer 0–100
  basis: RiskScoreBasis;
};

/**
 * Compute the numeric score for a (likelihood, impact) pair.
 *
 * Returns null when either axis is absent or not a recognized value — callers
 * treat null as "no score" (column stays NULL) rather than guessing. This is
 * why a partially-rated risk (e.g. impact set, likelihood not yet) carries no
 * score until both axes exist.
 */
export function computeRiskScore(
  likelihood: string | null | undefined,
  impact: string | null | undefined
): RiskScoreResult | null {
  if (!likelihood || !impact) return null;

  const lw = LIKELIHOOD_WEIGHTS[likelihood];
  const iw = IMPACT_WEIGHTS[impact];
  if (typeof lw !== "number" || typeof iw !== "number") return null;

  return {
    score: Math.round(lw * iw * 100),
    basis: { likelihood_weight: lw, impact_weight: iw }
  };
}

/**
 * Map a 0–100 score to a band. Thresholds (ratified): Critical ≥75,
 * High ≥50, Moderate ≥25, Low <25. Returns null for a null/invalid score.
 */
export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Moderate";
  return "Low";
}
