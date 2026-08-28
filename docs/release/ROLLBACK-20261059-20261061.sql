-- ROLLBACK for the VA-Q1 schema (20261059 primitives, 20261060 version
-- addressing, 20261061 bridge backfill — the last is appended when P3 lands).
--
-- Order matters: the version FKs are ON DELETE RESTRICT, so every stamp must be
-- cleared BEFORE the content tables can be dropped. Every step is idempotent.
--
-- Code rollback (redeploy the previous SHA) is always sufficient on its own:
-- the requirement-keyed read path is intact throughout Q1, and every new
-- column is nullable. Run this only if the schema itself must go.

-- ── 20261060 — version addressing ──────────────────────────────────────────
UPDATE requirement_response_revisions SET question_version_id = NULL WHERE question_version_id IS NOT NULL;
UPDATE requirement_responses          SET question_version_id = NULL WHERE question_version_id IS NOT NULL;
UPDATE vendor_engagement_scope_items  SET question_version_id = NULL WHERE question_version_id IS NOT NULL;
UPDATE vendor_engagements             SET question_set_hash = NULL, question_set_hash_at = NULL
  WHERE question_set_hash IS NOT NULL OR question_set_hash_at IS NOT NULL;

DROP INDEX IF EXISTS idx_vendor_engagement_scope_items_version;
ALTER TABLE requirement_response_revisions DROP COLUMN IF EXISTS question_version_id;
ALTER TABLE requirement_responses          DROP COLUMN IF EXISTS question_version_id;
ALTER TABLE vendor_engagement_scope_items  DROP COLUMN IF EXISTS question_version_id;
ALTER TABLE vendor_engagements             DROP COLUMN IF EXISTS question_set_hash_at;
ALTER TABLE vendor_engagements             DROP COLUMN IF EXISTS question_set_hash;

-- ── 20261059 — content primitives ──────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_question_versions_immutable ON question_versions;
DROP TRIGGER IF EXISTS trg_question_versions_no_truncate ON question_versions;
-- worm_guard_mutation is the platform's shared guard (20261018); never dropped here.
DROP TABLE IF EXISTS question_requirement_links;
DROP TABLE IF EXISTS question_versions;
DROP TABLE IF EXISTS questions;
