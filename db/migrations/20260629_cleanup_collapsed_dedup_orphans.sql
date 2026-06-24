-- Migration: cleanup_collapsed_dedup_orphans
-- One-time cleanup of the stale rows left by the pre-fix dedup-hash collapse.
--
-- BACKGROUND. Before 20260624_cyber_signals_external_id, dedup_hash was
-- sha256(source|signal_type|affected_cve|affected_vendor). Vendorless/CVE-less
-- sources (the regulatory feeds) hashed every item to an identical
-- source|signal_type|| key, so ON CONFLICT kept only the FIRST item per
-- (source, signal_type) — a single stale "orphan" survivor per regulatory source.
--
-- WHY THIS DELETE IS PROVABLY SAFE (cannot touch a legitimate row):
--   - Post-fix, the regulatory mappers (regulatoryHelpers.ts) ALWAYS set
--     external_id = guid ?? link. So for source ∈ {nist_news, ftc_news} a
--     regulatory_change row with external_id IS NULL is NECESSARILY a pre-fix
--     collapsed row — no post-fix regulatory row from these sources lacks an
--     external_id.
--   - The filter is pinned to those two sources + regulatory_change, so it
--     CANNOT match the legitimately-NULL-external_id rows of CISA KEV / NVD
--     (different sources, which set no external_id by design).
--   - News sources (bleepingcomputer/krebs/sans) are deliberately EXCLUDED: a
--     title-only RSS item with neither guid nor link could legitimately have a
--     NULL external_id, so deleting on those sources is not provably safe.
--
-- Idempotent (re-run deletes 0), and a no-op on fresh deployments (no orphans).
-- Not reversible by design — the deleted rows are stale; the feeds re-ingest
-- proper per-item rows on the next cron cycle.

DELETE FROM cyber_signals
WHERE external_id IS NULL
  AND signal_type = 'regulatory_change'
  AND source IN ('nist_news', 'ftc_news');
