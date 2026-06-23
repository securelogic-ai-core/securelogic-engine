/**
 * signalTargetMatching.ts — scoring for the signal→obligation suggestion
 * generator (GAP-1).
 *
 * Pure functions, no DB. `runMatcherForSignal` (cyberSignalProcessingService.ts)
 * calls `scoreObligationMatch` against each candidate obligation, then applies
 * MIN_MATCH_SCORE (drop anything below) and SUGGESTION_CAP (keep the top-N by
 * score) before writing `signal_match_suggestions` rows.
 *
 * SCORING MODEL — regulation identity, with domain as a weak tiebreaker.
 * The dominant question is "does the signal cite THIS obligation's
 * source_regulation?". Regulation identity alone clears the threshold; domain
 * overlap alone never does. This deliberately prevents the cross-regulation
 * false positive of loose bag-of-words overlap (a GDPR-specific signal must not
 * match a CCPA obligation just because both are domain "data protection"), and
 * the corresponding false negative (the true GDPR match being dragged below
 * threshold by domain tokens the signal didn't echo). See scoreObligationMatch.
 *
 * Scores are INTEGER [0,100] — the live domain of
 * `signal_match_suggestions.match_score` (CHECK BETWEEN 0 AND 100; the original
 * NUMERIC(4,3)/"0.000–1.000" was superseded by the type-fix migration).
 *
 * Matching is lexical (no CPE/identifier/semantics) — a suggestion the user
 * reviews, never an automatic link. Precision tuning lives behind
 * MIN_MATCH_SCORE.
 *
 * NOTE: the signal→control branch was removed from this package — token overlap
 * cannot bridge CVE-feed vocabulary to control names; it is being rebuilt as a
 * separate LLM-based package.
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

/** Score awarded when the signal cites the obligation's source_regulation. */
const REGULATION_BASE_SCORE = 80;
/** Max additional points the domain tiebreaker can add on top of a reg match. */
const DOMAIN_TIEBREAK_MAX = 20;

/**
 * How many of `needles` appear in `haystack`, and whether ALL of them do.
 * `all` is false for an empty needle set (nothing to identify).
 */
function tokensPresent(
  needles: Set<string>,
  haystack: Set<string>
): { all: boolean; fraction: number } {
  if (needles.size === 0) return { all: false, fraction: 0 };
  let hits = 0;
  for (const t of needles) {
    if (haystack.has(t)) hits++;
  }
  return { all: hits === needles.size, fraction: hits / needles.size };
}

/**
 * Score an obligation against a signal by REGULATION IDENTITY, with domain as a
 * weak tiebreaker. Integer [0,100].
 *
 * Model:
 *   - The signal must CITE the obligation's source_regulation: every distinct
 *     token of source_regulation must appear in the signal text (e.g. "GDPR"
 *     for source_regulation "GDPR"). Acronyms / distinctive names match best;
 *     a regulation that tokenizes to nothing (empty/too-short) can never be
 *     cited and scores 0.
 *   - Regulation cited → REGULATION_BASE_SCORE (80), already well above
 *     MIN_MATCH_SCORE. Domain-token overlap adds up to DOMAIN_TIEBREAK_MAX (20)
 *     as a nudge among obligations that already match on regulation.
 *   - Regulation NOT cited → 0. Domain overlap ALONE never scores, so two
 *     obligations sharing a domain ("data protection") but citing different
 *     regulations (GDPR vs CCPA) are NOT both suggested on a GDPR-specific
 *     signal — and the true GDPR match is never dragged below threshold by
 *     domain tokens the signal happened not to echo.
 */
export function scoreObligationMatch(
  signalText: string,
  obligation: { source_regulation: string | null; domain: string | null }
): number {
  const signalTokens = tokenize(signalText);

  const regTokens = tokenize(obligation.source_regulation ?? "");
  const reg = tokensPresent(regTokens, signalTokens);
  if (!reg.all) return 0; // regulation not cited → no match

  const domainTokens = tokenize(obligation.domain ?? "");
  const domain = tokensPresent(domainTokens, signalTokens);
  const tiebreak = Math.round(domain.fraction * DOMAIN_TIEBREAK_MAX);

  return Math.min(100, Math.max(0, REGULATION_BASE_SCORE + tiebreak));
}
