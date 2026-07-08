/**
 * briefQualityFeatureFlag.ts — kill switch for the title/summary quality
 * contract on customer-facing brief items. IQP Q4 (Phase 1 audit defects
 * #1 — mid-word 77-char title cuts with a literal "..." — and #2 — summaries
 * that merely repeat the title).
 *
 * When ON:
 *   1. Brief item titles are capped at 120 chars on a WORD/SENTENCE boundary
 *      via the existing contentQuality.trimToSentence (built for the event
 *      layer in IE.P2, wired into the LIVE brief path here) — never a
 *      mid-word slice, never a bare literal "...".
 *   2. The normalizer's payload-derived summary uses trimToSentence(·, 500)
 *      instead of slice(0, 497) + "..." — whole sentences only.
 *   3. A brief item whose summary restates its title (equal or prefix,
 *      case/whitespace-insensitive) gets a deterministic entity-synthesized
 *      executive summary instead — summary NEVER simply restates the title.
 *   4. Duplicate titles across one brief are collapsed (first — i.e. highest
 *      relevance/recency after sort — wins; drops are logged by the caller).
 *
 * When OFF — the default in EVERY environment — all four behaviors revert to
 * the exact legacy output, byte-identical.
 *
 * OFF by default. Enabled ONLY when SECURELOGIC_BRIEF_QUALITY_ENABLED
 * === "true". Production enablement is operator-owned; staging first
 * (docs/validation/iqp-operator-ledger.md).
 */
export function briefQualityEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_BRIEF_QUALITY_ENABLED"] === "true";
}
