/**
 * intelligenceEventIdentity.ts — canonical Intelligence Event identity.
 * Intelligence Pipeline Hardening / IE.P1 (design memo IE-INTELLIGENCE-EVENTS-MEMO.md).
 *
 * A canonical Intelligence Event is the durable, org-agnostic object that many
 * cyber_signals (across sources and across the global/per-org partitions)
 * collapse into. `eventCanonicalKey()` is the deterministic identity that
 * decides which event a signal belongs to.
 *
 * IE-AD-2 — the identity is a TOTAL promotion of clusterKey():
 *   1. clusterKey() result if non-null  → cve:CVE-…  (CVE-primary, source-agnostic)
 *                                          fp:vendor|type|utc-day (CVE-less corroboration)
 *   2. otherwise                         → sig:<dedup_hash>  (stable per-signal singleton)
 *
 * clusterKey() returns null for degenerate signals (no CVE, no vendor). An event
 * layer cannot have orphans — every signal must map to exactly one event — so the
 * singleton branch keys on the signal's own dedup_hash. This never over-merges
 * (dedup_hash is already the exact-duplicate identity) and never loses a signal.
 *
 * PURE + DETERMINISTIC + GLOBAL: no I/O, no wall-clock read (the CVE-less bucket
 * uses the signal's own ingestion_timestamp), no organization_id. The same
 * signal always yields the same canonical key. Never reads or affects dedup_hash
 * as a mutation — it only consumes it as the singleton fallback.
 */

import { clusterKey, type ClusterKeyInput } from "./clusterKey.js";

/** Prefix for per-signal singleton events: `sig:<dedup_hash>`. */
export const EVENT_KEY_SINGLETON_PREFIX = "sig:";

/** The read-only signal shape the canonical key derives from. */
export interface EventIdentityInput extends ClusterKeyInput {
  /** cyber_signals.dedup_hash — the exact-duplicate identity (singleton fallback). */
  readonly dedup_hash: string;
}

/**
 * Compute the canonical Intelligence Event key for a signal. Total: always
 * returns a non-empty, stable, deterministic key.
 *
 *   cve:<CVE>                                a valid CVE is present
 *   fp:<vendor>|<signal_type>|<yyyy-mm-dd>   no CVE but a vendor is present
 *   sig:<dedup_hash>                         otherwise (singleton — no over-merge)
 */
export function eventCanonicalKey(signal: EventIdentityInput): string {
  const soft = clusterKey(signal);
  if (soft !== null) return soft;
  return EVENT_KEY_SINGLETON_PREFIX + signal.dedup_hash;
}

/** True when the key is a per-signal singleton (no corroboration grouping). */
export function isSingletonKey(key: string): boolean {
  return key.startsWith(EVENT_KEY_SINGLETON_PREFIX);
}

// ---------------------------------------------------------------------------
// Severity ordering — shared, so event severity = the peak across contributors.
// ---------------------------------------------------------------------------

/** cyber_signals.severity domain, most-severe first. */
export const SEVERITY_ORDER = ["Critical", "High", "Moderate", "Low"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

/** Numeric rank (0 = Critical … 3 = Low; unknown → 4, sorts last). */
export function severityRank(severity: string): number {
  const idx = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

/** The more-severe of two severities (lower rank wins). Unknown loses. */
export function peakSeverity(a: string, b: string): string {
  return severityRank(a) <= severityRank(b) ? a : b;
}
