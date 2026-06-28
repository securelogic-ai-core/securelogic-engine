/**
 * Signal-clustering feature flag — Priority 4 / Phase 4C.
 *
 * Gates the cluster-aware brief bucketing (the C3b fingerprint-merge pass). When
 * off — the default in EVERY environment, including dev/test — the brief is
 * byte-identical to pre-clustering (the existing mergeBriefItemsByCve CVE
 * grouping is unaffected; it is not gated by this flag).
 *
 * Default OFF everywhere because clustering mutates brief grouping/output; it is
 * deliberate opt-in, enabled in staging first and only AFTER the cluster_key
 * backfill has run (cluster_key is read from the persisted C2 column; NULL ⇒
 * singleton, so flag-on before backfill is a no-op).
 *
 * C3a wiring note: this getter ships in C3a as plumbing; nothing reads it until
 * the C3b bucketing pass lands.
 */

/** Reads `env["SECURELOGIC_SIGNAL_CLUSTERING_ENABLED"] === "true"` — OFF everywhere by default. */
export function signalClusteringEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_SIGNAL_CLUSTERING_ENABLED"] === "true";
}
