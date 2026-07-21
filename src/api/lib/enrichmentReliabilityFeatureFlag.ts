/**
 * enrichmentReliabilityFeatureFlag.ts — kill switch for the enrichment
 * reliability guard + alerting. IQP Q5 (Phase 1 audit defect #6: the April
 * incident — every brief item silently degraded to identical template
 * "Action" text with no operator signal; a missing OR invalid
 * ANTHROPIC_API_KEY produced a fully silent fallback because the key is
 * optional at boot and a 401 is not classified as an alertable error).
 *
 * When ON:
 *   1. A degraded enrichment batch (fallback rate ≥ 50%) fires
 *      sendSecurityAlert("brief_enrichment_degraded") — the April-incident
 *      detector. (Inert without ALERT_WEBHOOK_URL, like every alert.)
 *   2. An Anthropic auth failure (401/403) fires
 *      sendSecurityAlert("brief_enrichment_auth_failure") once per process —
 *      the most likely April root cause becomes loud.
 *   3. The CVE-grounding guard (briefSynthesizer.validateActionGrounding —
 *      built after the PR #25 hallucination incident but never wired) runs on
 *      Claude's recommended_actions: a response citing a CVE not present in
 *      the item is treated as contaminated → template fallback + telemetry,
 *      never shipped.
 *
 * When OFF — the default in EVERY environment — enrichment behavior and
 * output are byte-identical to pre-Q5. (The per-item enrichment_status
 * marker and the per-cycle brief_enrichment_summary LOG are pure telemetry,
 * always on, never customer-visible — the marker is stripped from
 * content_json unconditionally.)
 *
 * OFF by default. Enabled ONLY when SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED
 * === "true". Production enablement is operator-owned; staging first
 * (docs/validation/iqp-operator-ledger.md).
 */
export function enrichmentReliabilityEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED"] === "true";
}
