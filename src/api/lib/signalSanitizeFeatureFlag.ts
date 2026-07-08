/**
 * signalSanitizeFeatureFlag.ts — kill switch for intelligence-text HTML
 * sanitization at the canonical normalization boundary. IQP Q1 (Phase 1 audit
 * defect #3: raw feed HTML persisted into normalized_summary and rendered to
 * customers as literal visible tags).
 *
 * When ON, stripHtmlToText (sanitize.ts) runs in exactly two places:
 *   1. normalizeSignal — the stored normalized_summary of every NEW signal
 *      (all live INSERT paths flow through the canonical normalizer), and
 *   2. buildBriefItems — the brief item's title (derived from RAW
 *      raw_payload.title provenance, which never passes through 1) and its
 *      summary (covers pre-flag legacy rows still inside the brief window).
 * Renderers are untouched — they keep output ENCODING (escHtml / JSX), which
 * is not sanitization.
 *
 * When OFF — the default in EVERY environment — both call sites are skipped
 * and stored rows + brief content_json are byte-identical to pre-Q1.
 *
 * OFF by default. Enabled ONLY when SECURELOGIC_SIGNAL_SANITIZE_ENABLED
 * === "true". Production enablement is operator-owned; staging first
 * (docs/validation/iqp-operator-ledger.md).
 */
export function signalSanitizeEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_SIGNAL_SANITIZE_ENABLED"] === "true";
}
