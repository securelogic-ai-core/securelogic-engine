-- Migration: cyber_signals_external_id
-- Dedup-hash collapse fix — add a stable per-item identifier column.
--
-- THE BUG: dedup_hash was sha256(source|signal_type|affected_cve|affected_vendor)
-- and nothing else. Any source with no CVE and no vendor — every regulatory feed
-- (nist_news, ftc_news) and news items with no CVE/vendor in the title — hashed
-- to an identical source|signal_type|| key, so ON CONFLICT (org, dedup_hash)
-- DO NOTHING kept only the FIRST item per (source, signal_type), forever.
--
-- THE FIX: when a source provides a stable per-item id (RSS guid/link, and in
-- future EDGAR accession / HHS breach id) it is stored here and becomes the sole
-- dedup discriminator (key shape source|signal_type|id:<external_id>). Sources
-- that already dedup correctly on a CVE (CISA KEV, NVD) leave external_id NULL
-- and keep their exact legacy hash — see buildDedupHash in cyberSignalNormalizer.ts.
--
-- Additive, nullable, NO backfill: existing rows keep external_id = NULL and
-- therefore keep their current dedup_hash. Adding a nullable column with no
-- default is a metadata-only operation in modern Postgres — no table rewrite,
-- no null window. Reversible by hand: ALTER TABLE cyber_signals DROP COLUMN external_id;
--
-- NOTE: this migration does NOT clean up the pre-existing collapsed rows (the
-- single stale source|signal_type|| row per affected feed). That cleanup is a
-- deferred, optional, destructive follow-up and is intentionally out of scope here.

ALTER TABLE cyber_signals
  ADD COLUMN IF NOT EXISTS external_id TEXT NULL;
