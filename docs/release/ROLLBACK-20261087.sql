-- ROLLBACK for 20261087_vendor_relationship_intake.sql (Vendor Onboarding 2.0, VO-2)
--
-- Run this BEFORE ROLLBACK-20261086.sql.
--
-- The migration is additive: one new append-only table, its guard triggers,
-- one FK added to vendor_relationships, RLS, grant. Code rollback alone is
-- sufficient before VO-6 wires the write path.
--
-- DATA LOSS, stated plainly: this discards the FACTUAL INTAKE HISTORY — what
-- the customer declared about each relationship, every version. That is not
-- re-derivable from anything; it is the source of truth the engines read.
-- Take a copy first:
--
--   CREATE TABLE vendor_relationship_intake_backup_20261087 AS SELECT * FROM vendor_relationship_intake;
--
-- The append-only guard refuses DELETE and TRUNCATE on the table, but not
-- DROP TABLE, so this rollback does not need to disable it.

ALTER TABLE vendor_relationships DROP CONSTRAINT IF EXISTS vendor_relationships_classification_intake_fk;
DROP TABLE IF EXISTS vendor_relationship_intake;
