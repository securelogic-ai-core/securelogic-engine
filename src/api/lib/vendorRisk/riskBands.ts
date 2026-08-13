/**
 * riskBands.ts — the band vocabulary and polarity for Vendor Assurance scores.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POLARITY. READ THIS BEFORE ADDING ANY SCORE.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `docs/scoring-vocabulary.md` is an ACCEPTED governing note. It records that
 * the platform already persists several 0–100 "scores" with DIFFERENT polarity,
 * that they are not interchangeable, and that a bare risk number with no scale
 * context is actively misleading:
 *
 *   risks.inherent_score / residual_score   0-100, HIGHER = WORSE
 *   vendors.current_risk_score              0-100, HIGHER = BETTER  ← inverted
 *
 * The note names that vendor↔risk inversion as deferred debt and forbids
 * blending the two.
 *
 * Vendor Assurance's inherent and residual scores adopt the RISK-REGISTER
 * polarity and bands — higher = worse, Critical ≥75 / High ≥50 / Moderate ≥25 /
 * Low <25 — and live in their own columns on vendor_engagements.
 *
 * They must NEVER be written to `vendors.current_risk_score`, which runs the
 * other way. Writing a higher-is-worse number into that column would be
 * silently inverted on every surface that reads it, which is exactly the class
 * of bug the vocabulary note exists to prevent. That column is frozen with its
 * legacy formula and deprecated in place; the vendor list surfaces the BAND
 * STRING instead of a raw number.
 *
 * No new vocabulary is introduced anywhere in this methodology: the four band
 * names are the platform's existing PascalCase severity vocabulary, the same
 * one used by findings.severity, risks.risk_rating and vendor_assessments.
 */

/** The platform's PascalCase severity vocabulary. Do not introduce a fifth value. */
export const RISK_BANDS = ["Low", "Moderate", "High", "Critical"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** Rank for comparison. Higher rank = worse. */
const BAND_RANK: Record<RiskBand, number> = {
  Low: 0,
  Moderate: 1,
  High: 2,
  Critical: 3,
};

/**
 * Lower bound of each band on the 0–100 scale. Identical cut points to the risk
 * register (docs/scoring-vocabulary.md) so a reader who knows one knows both.
 */
export const BAND_MIN_SCORE: Record<RiskBand, number> = {
  Low: 0,
  Moderate: 25,
  High: 50,
  Critical: 75,
};

/** Score → band. HIGHER = WORSE. */
export function bandForScore(score: number): RiskBand {
  if (score >= BAND_MIN_SCORE.Critical) return "Critical";
  if (score >= BAND_MIN_SCORE.High) return "High";
  if (score >= BAND_MIN_SCORE.Moderate) return "Moderate";
  return "Low";
}

/** The worse of two bands. */
export function maxBand(a: RiskBand, b: RiskBand): RiskBand {
  return BAND_RANK[a] >= BAND_RANK[b] ? a : b;
}

/** True when `a` is strictly worse than `b`. */
export function bandExceeds(a: RiskBand, b: RiskBand): boolean {
  return BAND_RANK[a] > BAND_RANK[b];
}

/**
 * Assessment tier. A pure relabelling of the inherent band — deliberately NOT a
 * second scale. Tier drives questionnaire depth; the band drives how the number
 * reads. Keeping them 1:1 means a customer can never be shown a Tier 1 vendor
 * whose inherent risk renders as Moderate.
 */
export const ASSESSMENT_TIERS = [
  "tier_4_low",
  "tier_3_moderate",
  "tier_2_high",
  "tier_1_critical",
] as const;
export type AssessmentTier = (typeof ASSESSMENT_TIERS)[number];

const BAND_TO_TIER: Record<RiskBand, AssessmentTier> = {
  Low: "tier_4_low",
  Moderate: "tier_3_moderate",
  High: "tier_2_high",
  Critical: "tier_1_critical",
};

export function tierForBand(band: RiskBand): AssessmentTier {
  return BAND_TO_TIER[band];
}

/** Clamp to the 0–100 integer scale both scores share. */
export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
