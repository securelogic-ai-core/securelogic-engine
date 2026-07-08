/**
 * signalRecencyFeatureFlag.ts — kill switch for source-authoritative recency
 * enforcement on the customer-facing brief window. IQP Q2 (Phase 1 audit
 * defect #4: very old vulnerabilities — e.g. CVE-2008-4250 — surfaced as
 * current Critical/Open because the window filtered on ingestion_timestamp,
 * which is always NOW() at ingest).
 *
 * When ON, the brief-window queries filter on the EFFECTIVE event date
 * COALESCE(published_at, ingestion_timestamp): a signal whose source says it
 * is old falls OUTSIDE the window and is suppressed; a signal with no known
 * event date behaves exactly as before (ingestion-time fallback). Suppressed
 * rows are counted and logged (stale_signal_suppressed) per generation run.
 *
 * When OFF — the default in EVERY environment — the legacy ingestion-time
 * window runs byte-identically. Writing published_at is NOT gated (an unread
 * nullable column is behavior-neutral); only reads are.
 *
 * BACKFILL SAFETY: because old published_at values only ever REMOVE rows from
 * the window, enabling this flag can never re-surface historical intelligence
 * as new.
 *
 * OFF by default. Enabled ONLY when SECURELOGIC_SIGNAL_RECENCY_ENABLED
 * === "true". Production enablement is operator-owned; staging first
 * (docs/validation/iqp-operator-ledger.md).
 */
export function signalRecencyEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_SIGNAL_RECENCY_ENABLED"] === "true";
}
