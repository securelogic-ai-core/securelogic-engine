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
 * SEVERITY AUTHORITY (ratified): `risks.residual_rating` (the analyst-set
 * string) remains the AUTHORITATIVE severity for a risk — it can reflect a
 * post-controls judgment that intentionally differs from raw arithmetic.
 * `residual_score` is a DERIVED PROJECTION of the residual axes, used only for
 * magnitude / intra-band ordering / heatmap intensity / tie-breaking. It must
 * never be used to reorder a risk ACROSS what its rating asserts. `scoreBand()`
 * exists so callers can detect (and surface) rating↔score divergence; it does
 * not override the rating.
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

/** The raw weighted inputs that produced a score. */
export type RiskScoreInputs = {
  likelihood_weight: number;
  impact_weight: number;
};

/**
 * Versioned explainability envelope persisted in `risks.score_basis`.
 *
 * The `method`/`version` tag is the forward seam: a future score producer
 * (e.g. an AI-drafted risk carrying model + confidence + rationale) extends
 * this shape by adding a new method tag and fields, with NO JSONB reshape or
 * backfill of existing rows. `score` records WHICH axis pair the basis
 * explains — residual is the ranking key; inherent is carried for symmetry.
 *
 * NOTE: anything a future producer adds here (e.g. an AI `rationale`) must be
 * sanitized before persistence — `score_basis` is tenant-visible.
 */
export type RiskScoreBasis = {
  method: "likelihood_impact_v1";
  version: 1;
  score: "residual" | "inherent";
  inputs: RiskScoreInputs;
};

export type RiskScoreResult = {
  score: number; // integer 0–100
  basis: RiskScoreBasis;
};

/**
 * Compute the numeric score for a (likelihood, impact) pair.
 *
 * `axis` tags the returned basis ("residual" default; "inherent" for the
 * inherent pair) so a persisted envelope is self-describing. Returns null when
 * either axis value is absent or not recognized — callers treat null as "no
 * score" (column stays NULL) rather than guessing. This is why a partially
 * rated risk (e.g. impact set, likelihood not yet) carries no score until both
 * axes exist.
 */
export function computeRiskScore(
  likelihood: string | null | undefined,
  impact: string | null | undefined,
  axis: "residual" | "inherent" = "residual"
): RiskScoreResult | null {
  if (!likelihood || !impact) return null;

  const lw = LIKELIHOOD_WEIGHTS[likelihood];
  const iw = IMPACT_WEIGHTS[impact];
  if (typeof lw !== "number" || typeof iw !== "number") return null;

  return {
    score: Math.round(lw * iw * 100),
    basis: {
      method: "likelihood_impact_v1",
      version: 1,
      score: axis,
      inputs: { likelihood_weight: lw, impact_weight: iw }
    }
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
