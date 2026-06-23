/**
 * signalTargetMatching.ts — scoring for the signal→control / signal→obligation
 * suggestion generator (GAP-1).
 *
 * Pure functions, no DB. `runMatcherForSignal` (cyberSignalProcessingService.ts)
 * calls these to score each candidate control/obligation against a signal, then
 * applies MIN_MATCH_SCORE (drop anything below) and SUGGESTION_CAP (keep the
 * top-N by score) before writing `signal_match_suggestions` rows.
 *
 * Scores are INTEGER [0,100] — the live domain of
 * `signal_match_suggestions.match_score` (CHECK BETWEEN 0 AND 100; the original
 * NUMERIC(4,3)/"0.000–1.000" was superseded by the type-fix migration). Overlap
 * is computed as a [0,1] fraction then scaled ×100, rounded, and clamped —
 * mirroring computeRiskScore's `product * 100 → clampInteger`.
 *
 * Matching is deliberately crude (token overlap, no CPE/identifier/semantics) —
 * a suggestion the user reviews, never an automatic link. Precision tuning lives
 * behind MIN_MATCH_SCORE.
 */

/** Suggestions below this score are not written. Integer on the 0–100 scale. */
export const MIN_MATCH_SCORE = 40;

/** Max suggestions written per (signal, org) per branch — trims pathological fan-out. */
export const SUGGESTION_CAP = 20;

// Common words that carry no matching signal. Kept small and conservative —
// over-stripping would hurt the already-crude overlap.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "has",
  "have", "will", "your", "you", "not", "but", "all", "any", "can", "per",
  "via", "into", "onto", "over", "under", "new", "may", "its", "our", "their"
]);

/**
 * Lowercase, split on non-alphanumeric, drop tokens shorter than 3 chars and
 * stopwords. Returns the distinct token set.
 */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * Fraction of the target's distinct tokens that appear in the signal, scaled to
 * an integer [0,100]. Empty target → 0 (nothing to match against).
 */
function overlapScore(signalTokens: Set<string>, targetText: string): number {
  const targetTokens = tokenize(targetText);
  if (targetTokens.size === 0) return 0;
  let hits = 0;
  for (const t of targetTokens) {
    if (signalTokens.has(t)) hits++;
  }
  const fraction = hits / targetTokens.size;
  return Math.min(100, Math.max(0, Math.round(fraction * 100)));
}

/**
 * Score a control against a signal by keyword overlap between the signal text
 * and the control's name + description. Integer [0,100].
 */
export function scoreControlMatch(
  signalText: string,
  control: { name: string; description: string | null }
): number {
  const signalTokens = tokenize(signalText);
  return overlapScore(signalTokens, `${control.name} ${control.description ?? ""}`);
}

/**
 * Score an obligation against a signal by overlap between the signal text and
 * the obligation's source_regulation + domain (the structured match keys).
 * Integer [0,100].
 */
export function scoreObligationMatch(
  signalText: string,
  obligation: { source_regulation: string | null; domain: string | null }
): number {
  const signalTokens = tokenize(signalText);
  return overlapScore(
    signalTokens,
    `${obligation.source_regulation ?? ""} ${obligation.domain ?? ""}`
  );
}
