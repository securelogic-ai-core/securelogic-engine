/**
 * signalTargetMatching.ts — scoring for the signal→obligation suggestion
 * generator (GAP-1).
 *
 * Pure functions, no DB. `runMatcherForSignal` (cyberSignalProcessingService.ts)
 * calls `scoreObligationMatch` against each candidate obligation, then applies
 * MIN_MATCH_SCORE (drop anything below) and SUGGESTION_CAP (keep the top-N by
 * score) before writing `signal_match_suggestions` rows.
 *
 * SCORING MODEL — regulation-FAMILY identity, with domain and citation-suffix
 * precision as weak tiebreakers. The dominant question is "does the signal cite
 * THIS obligation's regulation family?" — GDPR, HIPAA, SOC 2, NIST CSF — NOT its
 * full citation string. The seeded obligations are citation-style ("GDPR Art.
 * 32", "HIPAA §164.308", "SOC 2 CC6.1", "NIST CSF PR.AC-1") but real signals
 * cite the family only and never the clause suffix, so requiring every
 * source_regulation token scored every real match 0. Family identity alone
 * clears the threshold; domain overlap and clause-suffix echo only reorder
 * already-matched obligations and never lift a non-match over threshold. This
 * deliberately prevents the cross-regulation false positive of loose
 * bag-of-words overlap (a GDPR-specific signal must not match a CCPA obligation
 * just because both share a domain), and the corresponding false negative (the
 * true GDPR match dragged below threshold by domain tokens the signal didn't
 * echo). See REGULATION_FAMILIES and scoreObligationMatch.
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

/** Score awarded when the signal cites the obligation's regulation family. */
const REGULATION_BASE_SCORE = 80;
/** Max points the domain tiebreaker can add on top of a family match. */
const DOMAIN_TIEBREAK_MAX = 10;
/** Max points the citation-suffix precision tiebreaker can add. */
const CITATION_TIEBREAK_MAX = 10;

/**
 * Known regulation FAMILIES — the matching vocabulary.
 *
 * WHY a vocabulary rather than tokenizing `source_regulation` directly: the
 * seeded obligation library is CITATION-STYLE ("GDPR Art. 32", "HIPAA §164.308",
 * "SOC 2 CC6.1", "NIST CSF PR.AC-1"), but real regulatory signals cite the
 * FAMILY only ("GDPR", "HIPAA", "SOC 2", "NIST CSF") and never the clause
 * suffix. Requiring every source_regulation token (the old rule) therefore
 * scored every real match 0. We match on the family instead.
 *
 * `tokens` are the LITERAL whole-word tokens that constitute the family name,
 * matched verbatim (NOT through `tokenize`, which drops <3-char tokens). This is
 * deliberate: it keeps the short-but-distinctive tokens a bare leading-token
 * extraction would lose — the "2" in "SOC 2" (so a stray "soc" can't match), the
 * "eu"/"ai" in "EU AI Act" (so the family does not collapse to the over-common
 * lone token "act"). ALL of a family's tokens must be present for a cite.
 *
 * Ordering is irrelevant; `familyForRegulation` picks the most specific (most
 * tokens) family whose tokens all appear in the source_regulation string.
 */
const REGULATION_FAMILIES: { name: string; tokens: string[] }[] = [
  { name: "GDPR", tokens: ["gdpr"] },
  { name: "HIPAA", tokens: ["hipaa"] },
  { name: "CCPA", tokens: ["ccpa"] },
  { name: "PCI DSS", tokens: ["pci", "dss"] },
  { name: "SOC 2", tokens: ["soc", "2"] },
  { name: "ISO 27001", tokens: ["iso", "27001"] },
  { name: "NIST CSF", tokens: ["nist", "csf"] },
  { name: "EU AI Act", tokens: ["eu", "ai", "act"] }
];

/** Escape a literal token for safe inclusion in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does every literal token in `tokens` appear as a WHOLE word in `text`?
 * Whole-word is bounded by alphanumeric lookarounds (not `\b`, to avoid the
 * underscore-is-a-word-char quirk), so "soc" matches "SOC 2" but not "soccer",
 * and the short numeric "2" matches the standalone "2" but not "27001".
 * An empty token list returns false (nothing to identify).
 */
function allTokensPresent(tokens: string[], text: string): boolean {
  if (tokens.length === 0) return false;
  const hay = text.toLowerCase();
  return tokens.every((tok) =>
    new RegExp(`(?<![a-z0-9])${escapeRegExp(tok)}(?![a-z0-9])`).test(hay)
  );
}

/**
 * Identify which known regulation family an obligation's `source_regulation`
 * belongs to — the most specific family whose every token appears in the
 * citation string. Returns null for an unrecognized/empty regulation (which can
 * never be matched and scores 0).
 */
function familyForRegulation(
  source_regulation: string | null
): { name: string; tokens: string[] } | null {
  if (!source_regulation) return null;
  let best: { name: string; tokens: string[] } | null = null;
  for (const fam of REGULATION_FAMILIES) {
    if (
      allTokensPresent(fam.tokens, source_regulation) &&
      (best === null || fam.tokens.length > best.tokens.length)
    ) {
      best = fam;
    }
  }
  return best;
}

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
 * Score an obligation against a signal by REGULATION-FAMILY IDENTITY, with two
 * bounded tiebreakers (domain overlap, citation-suffix precision). Integer
 * [0,100].
 *
 * Model:
 *   - Resolve the obligation's regulation FAMILY from its citation-style
 *     source_regulation ("GDPR Art. 32" → family GDPR). A signal CITES the
 *     obligation when every token of that family appears in the signal text
 *     ("GDPR", or both "soc"+"2" for SOC 2). The clause suffix (Art. 32,
 *     §164.308, CC6.1, PR.AC-1) is NOT required — real signals never carry it.
 *   - Family cited → REGULATION_BASE_SCORE (80), already well above
 *     MIN_MATCH_SCORE. Two bounded nudges then only REORDER already-matched
 *     obligations (never lift a non-match over threshold):
 *       • domain-token overlap → up to DOMAIN_TIEBREAK_MAX (10)
 *       • citation-suffix precision → up to CITATION_TIEBREAK_MAX (10), awarded
 *         when the signal ALSO echoes the clause tokens beyond the family. Its
 *         presence raises the score; its ABSENCE never zeroes the match.
 *   - Family NOT cited (or unrecognized regulation) → 0. Domain overlap ALONE
 *     never scores, so two obligations sharing a domain but citing different
 *     regulations (GDPR vs CCPA) are NOT both suggested on a GDPR-specific
 *     signal — and the true GDPR match is never dragged below threshold by
 *     domain tokens the signal happened not to echo.
 */
export function scoreObligationMatch(
  signalText: string,
  obligation: { source_regulation: string | null; domain: string | null }
): number {
  const family = familyForRegulation(obligation.source_regulation);
  if (family === null) return 0; // regulation unrecognized → no match
  if (!allTokensPresent(family.tokens, signalText)) return 0; // family not cited

  const signalTokens = tokenize(signalText);

  // Domain tiebreak — fraction of the obligation's domain tokens the signal echoes.
  const domainTokens = tokenize(obligation.domain ?? "");
  const domain = tokensPresent(domainTokens, signalTokens);
  const domainTiebreak = Math.round(domain.fraction * DOMAIN_TIEBREAK_MAX);

  // Citation-suffix tiebreak — fraction of the clause tokens BEYOND the family
  // (e.g. "164"/"308" for "HIPAA §164.308") the signal echoes. Empty suffix
  // (e.g. NIST CSF, whose clause tokenizes away) contributes nothing.
  const suffixTokens = new Set<string>();
  for (const t of tokenize(obligation.source_regulation ?? "")) {
    if (!family.tokens.includes(t)) suffixTokens.add(t);
  }
  const suffix = tokensPresent(suffixTokens, signalTokens);
  const citationTiebreak = Math.round(suffix.fraction * CITATION_TIEBREAK_MAX);

  return Math.min(
    100,
    Math.max(0, REGULATION_BASE_SCORE + domainTiebreak + citationTiebreak)
  );
}
