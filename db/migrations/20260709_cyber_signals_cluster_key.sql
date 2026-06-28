-- Migration: cyber_signals_cluster_key
-- Priority 4 / Phase 4C / story C2 — additive soft-clustering column.
--
-- Adds `cluster_key` (the SOFT corroboration grouping computed by C1's
-- clusterKey(), src/api/lib/signals/clusterKey.ts) BESIDE dedup_hash. This is a
-- separate, NON-UNIQUE, lossy grouping — NOT deduplication.
--
-- R-1 INVARIANT (untouched): dedup_hash and its two UNIQUE indexes
-- (idx_cyber_signals_dedup, idx_cyber_signals_global_dedup) are the
-- exact-duplicate identity and are NOT modified here. No ON CONFLICT change.
--
-- C2 is INERT: nothing reads cluster_key yet (brief bucketing is C3, behind
-- SECURELOGIC_SIGNAL_CLUSTERING_ENABLED). New rows are inserted with NULL
-- cluster_key (the 13 INSERT sites are deliberately NOT touched); the column is
-- populated by the idempotent backfill script scripts/backfill-cluster-key.ts,
-- which derives values from the SAME C1 function (no SQL duplicate of the logic).
-- NULL ⇒ a singleton (clusters with nothing).
--
-- Additive + idempotent. Reversible:
--   DROP INDEX IF EXISTS idx_cyber_signals_cluster_key;
--   ALTER TABLE cyber_signals DROP COLUMN IF EXISTS cluster_key;

-- Nullable column: adding it is metadata-only (no table rewrite in PG 11+).
ALTER TABLE cyber_signals ADD COLUMN IF NOT EXISTS cluster_key TEXT;

-- NON-UNIQUE, partial index for C3's cluster lookups. Partial on NOT NULL keeps
-- it tiny (it is empty at creation — every row is NULL until the backfill runs —
-- so this builds instantly regardless of table size). MUST NOT be UNIQUE: a
-- cluster groups many rows. Distinct name; the dedup indexes are untouched.
CREATE INDEX IF NOT EXISTS idx_cyber_signals_cluster_key
  ON cyber_signals (cluster_key)
  WHERE cluster_key IS NOT NULL;
