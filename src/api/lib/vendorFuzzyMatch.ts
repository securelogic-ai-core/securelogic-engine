/**
 * vendorFuzzyMatch.ts — Phase-2 fuzzy vendor matching (SUGGEST-ONLY).
 *
 * Phase 1 (shipped) does normalization-then-EXACT: a signal's affected_vendor
 * canonicalizes and must equal a vendor's canonical name. That closes the
 * suffix/punctuation/case gap with zero false-positive risk and is safe to
 * auto-create a finding. It still MISSES the long tail: token-count variants
 * like NVD "palo alto networks" vs a customer's "Palo Alto", or EDGAR
 * "Sensata Technologies Holding plc" vs "Sensata".
 *
 * Phase 2 recovers that recall WITHOUT touching finding precision:
 *   - It runs ONLY when the exact branch found no vendor/AI match.
 *   - It writes signal_match_suggestions (target_type 'vendor') — a REVIEW-QUEUE
 *     suggestion — and NOTHING else. No findings, no risk flags. A false fuzzy
 *     match lands in front of a human reviewer, never the customer. (Same posture
 *     as the GAP-1 obligation branch.)
 *   - It is OFF by default behind SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED so it
 *     can be enabled per-environment after measuring precision against real
 *     vendors. The threshold below was NOT calibrated against production data.
 *
 * SIMILARITY: token-set Jaccard over the two ALREADY-canonical names (space-
 * split tokens). Jaccard — not containment — is deliberate: containment
 * (|A∩B|/min) makes a single common token catastrophic ("Oracle" ⊂ "Oracle
 * Health" → 1.0), the exact failure mode that makes naive fuzzy dangerous.
 * Jaccard penalizes the extra tokens ("oracle" vs "oracle health" = 1/2 = 0.50),
 * so a conservative threshold rejects it. Character typos are NOT caught (token
 * level only) — a deliberate precision-first limitation; that is Phase 2.x.
 *
 * SHORT-NAME SAFETY: short canonicals are exact-only (see MIN_CANONICAL_LEN). A
 * 2-char "hp" never reaches fuzzy, so it cannot Jaccard-collide with anything.
 *
 * Pure functions + an env read. No DB, no I/O. Worker-compiled (imported by the
 * matcher) — type-safe, no MatcherResult change.
 */

/** Jaccard*100 threshold a fuzzy candidate must clear to be SUGGESTED (not auto-matched). Conservative; tune via the precision-measurement query before enabling. */
export const FUZZY_VENDOR_MIN_SCORE = 60;

/** Max fuzzy suggestions written per (signal, org) — bounds review-queue volume. */
export const FUZZY_VENDOR_SUGGESTION_CAP = 10;

/** Canonical names shorter than this are EXACT-ONLY (no fuzzy). Protects short/common names (hp, f5, ibm, ca). */
export const FUZZY_VENDOR_MIN_CANONICAL_LEN = 5;

/**
 * Off by default everywhere. Only enabled when the env var is exactly "true"
 * — stricter than flags that default-on outside production, because this one
 * writes into customer-facing review queues.
 */
export function fuzzyVendorMatchEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED"] === "true";
}

/**
 * Token-set Jaccard similarity of two ALREADY-canonical vendor names, scaled to
 * an integer in [0, 100] (signal_match_suggestions.match_score is INTEGER).
 *
 * Inputs are expected to be the output of canonicalizeVendorName (lowercased,
 * punctuation flattened to single spaces). Returns 0 if either side has no
 * tokens. Identical inputs return 100 — but those are handled by the exact
 * branch and never reach fuzzy.
 */
export function vendorNameSimilarity(
  canonicalA: string,
  canonicalB: string
): number {
  const a = new Set(canonicalA.split(" ").filter((t) => t.length > 0));
  const b = new Set(canonicalB.split(" ").filter((t) => t.length > 0));
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return Math.round((intersection / union) * 100);
}
