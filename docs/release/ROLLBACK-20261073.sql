-- ROLLBACK for 20261073_vendor_tested_control_resolution.sql
--
-- The migration is purely additive: one new table, its indexes, its RLS policy
-- and its grant. Nothing existing was read, rewritten or constrained, so the
-- rollback is a drop and no data outside the new table is affected.
--
-- Dropping it DESTROYS the resolution history. That history is derivable again
-- by re-running resolution, but the `resolved_at` timestamps and any mapping
-- provenance whose crosswalk row has since been superseded are NOT recoverable.
-- Take a copy first if the record is wanted:
--
--   CREATE TABLE vendor_tested_control_resolutions_backup_20261073 AS
--     SELECT * FROM vendor_tested_control_resolutions;

DROP TABLE IF EXISTS vendor_tested_control_resolutions;
