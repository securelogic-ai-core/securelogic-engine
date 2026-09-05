-- ROLLBACK-20261093.sql — reverse 20261093_vendor_engagement_dispositions.sql
--
-- The migration is purely additive: one new table with its own triggers, policy
-- and grant. Nothing was backfilled and no existing table, column, row or index
-- was touched, so the reversal is a drop and the database returns to exactly its
-- prior state.
--
-- WHAT IS LOST: every recorded human disposition. That is real governance
-- content — who reviewed an engagement, who accepted it and why. Export it
-- before running this if the rows have any standing:
--
--   \copy (SELECT * FROM vendor_engagement_dispositions ORDER BY created_at)
--     TO 'dispositions-backup.csv' CSV HEADER
--
-- NOTHING ELSE depends on the table. No response, evidence row, scope item,
-- score, finding or lifecycle state is derived from it — "needs attention" is
-- computed from canonical truth and does not read this table — so dropping it
-- cannot change any assessment outcome. The application code that writes it
-- must be rolled back too, or POST /vendor-engagements/:id/disposition will
-- 500; the READ paths degrade to "no disposition recorded", which is the same
-- answer they give for an engagement nobody has dispositioned.

DROP TRIGGER IF EXISTS trg_vendor_engagement_dispositions_no_truncate
  ON vendor_engagement_dispositions;
DROP TRIGGER IF EXISTS trg_vendor_engagement_dispositions_worm
  ON vendor_engagement_dispositions;
DROP TRIGGER IF EXISTS vendor_engagement_dispositions_check_refs
  ON vendor_engagement_dispositions;

DROP TABLE IF EXISTS vendor_engagement_dispositions;

DROP FUNCTION IF EXISTS vendor_engagement_dispositions_check_refs();
