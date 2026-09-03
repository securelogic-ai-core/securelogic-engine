-- ROLLBACK for 20261086_vendor_relationships.sql (Vendor Onboarding 2.0, VO-2)
--
-- Run ROLLBACK-20261087.sql FIRST: 20261087 adds an FK from
-- vendor_relationships.classification_intake_id to vendor_relationship_intake,
-- and that table references this one. Order: 87 then 86.
--
-- The migration is additive: one new table, one nullable column on
-- vendor_engagements (never backfilled), indexes, RLS, grant. Nothing existing
-- was rewritten. Code rollback alone is sufficient: no shipped code path reads
-- these before VO-6 wires them, and the column is nullable so older code that
-- does not know it is unaffected.
--
-- DATA LOSS, stated plainly: dropping vendor_relationships discards every
-- relationship row and every DERIVED classification (criticality / inherent /
-- tier with their bases). The manual vendors.criticality is untouched. The
-- classifications are re-derivable from intake only if the intake table still
-- exists — so if you want them, run neither rollback and revert code instead.
-- Take a copy first if the record is wanted:
--
--   CREATE TABLE vendor_relationships_backup_20261086 AS SELECT * FROM vendor_relationships;

DROP INDEX IF EXISTS idx_vendor_engagements_relationship;
ALTER TABLE vendor_engagements DROP COLUMN IF EXISTS relationship_id;
DROP TABLE IF EXISTS vendor_relationships;
