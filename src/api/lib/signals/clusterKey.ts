/**
 * Multi-signal cluster key — Priority 4 / Phase 4C / slice C1.
 *
 * Maps a signal to a SOFT corroboration group ("these signals are about the same
 * event"), entirely SEPARATE from deduplication. It exists BESIDE `dedup_hash`
 * and never touches it:
 *
 *   - `dedup_hash` (cyberSignalNormalizer.ts) = exact-duplicate identity, backed
 *     by two UNIQUE indexes. NEVER modified by clustering (plan risk R-1).
 *   - `cluster_key` (here) = soft grouping for corroboration. Non-unique, lossy,
 *     additive. A null key means "clusters with nothing" (a singleton).
 *
 * Strategy (operator-approved):
 *   1. CVE-PRIMARY — a signal with a valid CVE keys on that CVE, so the same CVE
 *      from CISA KEV + NVD + security press collapses into one cluster
 *      regardless of source or vendor.
 *   2. CVE-LESS FINGERPRINT — otherwise, key on entity (vendor) + signal_type +
 *      UTC day-bucket.
 *   3. DEGENERATE — no valid CVE and no vendor ⇒ `null` (no cluster), so
 *      unrelated vendorless/CVE-less signals are NOT over-merged.
 *
 * SCOPE — C1 ships the PURE FUNCTION ONLY. There is no `cluster_key` column (C2),
 * no brief consumption (C3, behind SECURELOGIC_SIGNAL_CLUSTERING_ENABLED), and no
 * caller anywhere. It performs no I/O and changes no behavior — it cannot affect
 * dedup, ingestion, matching, or the brief.
 *
 * Tenancy: GLOBAL. `cluster_key` is a property of a global signal; `cyber_signals`
 * rows are org-agnostic and per-org scoping happens downstream at fan-out, never
 * here. No organization_id, no per-org data.
 *
 * Determinism: a pure function of the signal's OWN fields (including its
 * `ingestion_timestamp`) — no wall-clock read, so the same input always yields
 * the same key.
 */

/** Prefix for CVE-primary cluster keys: `cve:CVE-2026-1234`. */
export const CLUSTER_KEY_CVE_PREFIX = "cve:";
/** Prefix for CVE-less fingerprint keys: `fp:<vendor>|<signal_type>|<yyyy-mm-dd>`. */
export const CLUSTER_KEY_FP_PREFIX = "fp:";

/**
 * Canonical CVE shape — mirrors the validation used elsewhere (nvdAdapter) and
 * the uppercase-normalized form `affected_cve` is already stored in at ingest.
 */
const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/;

/** The minimal read-only signal shape the cluster key derives from. */
export interface ClusterKeyInput {
  readonly affected_cve: string | null;
  readonly affected_vendor: string | null;
  readonly signal_type: string;
  /** cyber_signals.ingestion_timestamp — TIMESTAMPTZ as ISO string or Date. */
  readonly ingestion_timestamp: string | Date;
}

/** Trim + uppercase a CVE and return it only if it is well-formed, else null. */
function normalizeCve(raw: string | null): string | null {
  if (!raw) return null;
  const cve = raw.trim().toUpperCase();
  return CVE_PATTERN.test(cve) ? cve : null;
}

/** UTC calendar day (YYYY-MM-DD) of a timestamp; null if unparseable. */
function utcDayBucket(ts: string | Date): string | null {
  const d = ts instanceof Date ? ts : new Date(ts);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return d.toISOString().slice(0, 10); // ISO-8601 is UTC ⇒ YYYY-MM-DD
}

/**
 * Compute a soft cluster key for a signal, or `null` for a singleton.
 *
 *   cve:<CVE>                              when a valid CVE is present
 *   fp:<vendor>|<signal_type>|<yyyy-mm-dd> when no CVE but a vendor is present
 *   null                                   otherwise (no over-merge)
 *
 * Never reads or affects `dedup_hash`.
 */
export function clusterKey(signal: ClusterKeyInput): string | null {
  const cve = normalizeCve(signal.affected_cve);
  if (cve) return CLUSTER_KEY_CVE_PREFIX + cve; // CVE-primary: vendor/source ignored

  const vendor = signal.affected_vendor?.trim().toLowerCase();
  if (!vendor) return null; // no CVE, no vendor ⇒ no cluster

  const day = utcDayBucket(signal.ingestion_timestamp);
  if (!day) return null; // unparseable timestamp ⇒ cannot fingerprint ⇒ singleton

  return `${CLUSTER_KEY_FP_PREFIX}${vendor}|${signal.signal_type}|${day}`;
}
