-- ROLLBACK for 20261068_canonical_control_crosswalk (VA-S4 Step 1).
--
-- Roll back 20261069 first if it has been applied; nothing in 69 references
-- these objects, but the package is rolled back as a unit.
--
-- DATA LOSS: drops the governed crosswalk, including every human APPROVAL
-- recorded against a mapping. The mapping content is version-controlled in
-- src/api/lib/controls/nistCsfCrosswalk.ts and republishable; the approvals are
-- not. Snapshot first:
--   COPY (SELECT * FROM canonical_control_crosswalk) TO '/tmp/crosswalk.csv' CSV HEADER;
--
-- frameworks.framework_key is dropped too. It is fully rederivable by re-running
-- the backfill in 20261068 (exact (name, version) match against the registry),
-- so no tenant information is lost.
--
-- Idempotent.

DROP TRIGGER IF EXISTS canonical_control_crosswalk_publication_guard ON canonical_control_crosswalk;
DROP FUNCTION IF EXISTS canonical_control_crosswalk_guard_publication();

DROP TABLE IF EXISTS canonical_control_crosswalk;

ALTER TABLE frameworks DROP CONSTRAINT IF EXISTS frameworks_canonical_identity_fkey;
DROP INDEX IF EXISTS idx_frameworks_canonical_identity;
ALTER TABLE frameworks DROP COLUMN IF EXISTS framework_key;

DROP TABLE IF EXISTS canonical_framework_versions;
