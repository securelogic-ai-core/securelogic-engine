/**
 * riskCadence.ts — Pure helpers for the RR-5 review cadence policy.
 *
 * The effective cadence (in days) for a risk is resolved in this order:
 *   1. per-risk override                  (risks.review_cadence_days)
 *   2. org policy                         (risk_settings.cadence_by_rating[residual_rating])
 *   3. documented defaults below          (DEFAULT_CADENCE_BY_RATING[residual_rating])
 *   4. fallback constant FALLBACK_DAYS    (when residual_rating is null/unknown)
 *
 * No I/O. No DB access. The route caller is responsible for fetching the
 * org's policy + the risk's residual rating and passing them in.
 *
 * NOTE on duplication: controlAssessments.ts:608 hardcodes a similar
 * CADENCE_DAYS map keyed by an enum (monthly/quarterly/biannual/annual).
 * That map and the one below have different semantics — controls map a
 * frequency enum to days; risks map a rating to days — and different
 * default values. They cannot share a single source of truth without
 * reshaping both. Flagged for a future settings-rationalization package.
 */

export const VALID_RATINGS = ["Critical", "High", "Moderate", "Low"] as const;
export type RatingKey = typeof VALID_RATINGS[number];

export const DEFAULT_CADENCE_BY_RATING: Record<RatingKey, number> = {
  Critical: 30,
  High:     60,
  Moderate: 90,
  Low:      180
};

/** Used when residual_rating is null/unknown — broad sweep. */
export const FALLBACK_DAYS = 90;

export function isRatingKey(v: unknown): v is RatingKey {
  return typeof v === "string" && (VALID_RATINGS as readonly string[]).includes(v);
}

/**
 * Resolve the cadence-in-days that should drive next_review_due.
 *
 * `policy` is the org's `risk_settings.cadence_by_rating` JSONB or null
 * if the org has no row. Per-rating absence in the policy falls through
 * to the defaults — the org doesn't have to specify all four.
 */
export function resolveCadenceDays(
  perRiskOverride: number | null,
  policy: Record<string, number> | null,
  residualRating: string | null
): number {
  if (perRiskOverride !== null && perRiskOverride > 0) {
    return perRiskOverride;
  }
  if (residualRating !== null && policy && typeof policy[residualRating] === "number" && policy[residualRating]! > 0) {
    return policy[residualRating]!;
  }
  if (isRatingKey(residualRating)) {
    return DEFAULT_CADENCE_BY_RATING[residualRating];
  }
  return FALLBACK_DAYS;
}
