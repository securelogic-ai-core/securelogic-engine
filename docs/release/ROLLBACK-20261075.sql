-- ROLLBACK for 20261075_tested_control_assertion.sql
--
-- Purely additive: one new table, its indexes, its RLS policy and its grant.
-- Nothing existing was read, rewritten or constrained.
--
-- Dropping it destroys the Layer-1 assertion history. The readings are
-- derivable again by re-materializing — the normalizer is deterministic and
-- versioned — but `asserted_at` and any `source_text` snapshot taken before a
-- later field override are NOT recoverable. Take a copy first if wanted:
--
--   CREATE TABLE vendor_tested_control_assertions_backup_20261075 AS
--     SELECT * FROM vendor_tested_control_assertions;

DROP TABLE IF EXISTS vendor_tested_control_assertions;
