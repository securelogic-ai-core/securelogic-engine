-- ROLLBACK for 20261090_applicability_challenge_and_intake_reason.sql (WA-2)
--
-- Additive: one nullable column with a CHECK on vendor_relationship_intake, and
-- one new append-only table. Code rollback is sufficient on its own — nothing
-- outside the WA-2 routes reads either object, and no composition, tier, scope
-- or Core Assurance decision consults them (a challenge is a record, never a
-- mechanism), so reverting the code leaves the platform behaving exactly as it
-- did before.
--
-- DATA LOSS, stated plainly:
--
--   * every recorded APPLICABILITY CHALLENGE is destroyed — who disputed which
--     determination, on which snapshot, and why. These are governance records
--     with attributed human authors; they are not reconstructable from
--     anything else, because nothing else stores a disagreement.
--   * every re-intake CHANGE REASON is discarded. The intake versions and
--     their facts survive (that table is untouched apart from the column), so
--     WHAT changed remains; only WHY is lost.
--
-- Take a copy first:
--
--   CREATE TABLE vendor_engagement_applicability_challenges_backup_20261090 AS
--     SELECT * FROM vendor_engagement_applicability_challenges;
--   CREATE TABLE vendor_relationship_intake_reason_backup_20261090 AS
--     SELECT id, organization_id, relationship_id, version, change_reason
--       FROM vendor_relationship_intake
--      WHERE change_reason IS NOT NULL;
--
-- NOTE on the WORM guard: the table's own append-only triggers refuse UPDATE
-- and DELETE, but DROP TABLE is DDL and is not intercepted by them. That is the
-- same posture every other WORM table in this schema takes — the guard protects
-- rows from the application, not the schema from an operator holding a
-- migration.

DROP TRIGGER IF EXISTS prevent_vendor_engagement_applicability_challenges_truncate
  ON vendor_engagement_applicability_challenges;
DROP TRIGGER IF EXISTS prevent_vendor_engagement_applicability_challenges_row_mutation
  ON vendor_engagement_applicability_challenges;
DROP TRIGGER IF EXISTS vendor_engagement_applicability_challenges_check_refs
  ON vendor_engagement_applicability_challenges;

DROP TABLE IF EXISTS vendor_engagement_applicability_challenges;
DROP FUNCTION IF EXISTS vendor_engagement_applicability_challenges_check_refs();

ALTER TABLE vendor_relationship_intake
  DROP CONSTRAINT IF EXISTS vendor_relationship_intake_change_reason_shape;
ALTER TABLE vendor_relationship_intake
  DROP COLUMN IF EXISTS change_reason;
