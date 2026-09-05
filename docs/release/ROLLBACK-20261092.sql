-- ROLLBACK-20261092.sql
--
-- Reverses 20261092_vendor_engagement_relationship_reseeds.sql.
--
-- The migration is purely additive: one table, its trigger function, its RLS
-- policy and one grant. Nothing else was altered, so unwinding it is a drop.
--
-- WHAT THIS DESTROYS, said plainly: every recorded reseed provenance row — the
-- prior basis, the new basis, the changed fields and the analyst's reason for
-- rebasing a pre-issue engagement onto its relationship's current
-- determination. The engagements themselves keep whatever basis they were
-- reseeded to; only the record of WHY they hold it goes. Capture the table
-- before running this if the history is wanted.
--
-- This is release-rollback mechanics and is the ONLY sanctioned way the rows
-- leave. Runtime application behaviour stays append-only: `app_request` holds
-- SELECT and INSERT only, and the shared worm_guard_mutation refuses UPDATE,
-- DELETE and TRUNCATE regardless of grant.

BEGIN;

DROP TRIGGER IF EXISTS trg_vendor_engagement_relationship_reseeds_no_truncate
  ON vendor_engagement_relationship_reseeds;
DROP TRIGGER IF EXISTS trg_vendor_engagement_relationship_reseeds_worm
  ON vendor_engagement_relationship_reseeds;
DROP TRIGGER IF EXISTS vendor_engagement_relationship_reseeds_check_refs
  ON vendor_engagement_relationship_reseeds;

DROP TABLE IF EXISTS vendor_engagement_relationship_reseeds;

DROP FUNCTION IF EXISTS vendor_engagement_relationship_reseeds_check_refs();

DELETE FROM schema_migrations
 WHERE filename = '20261092_vendor_engagement_relationship_reseeds.sql';

COMMIT;
