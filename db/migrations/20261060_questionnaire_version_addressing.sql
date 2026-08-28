-- 20261060_questionnaire_version_addressing.sql
--
-- VA-Q1 / P2 — address the questionnaire by question VERSION (ADR-0013 R3).
--
-- Additive, nullable, dual-write. Four columns, no data movement:
--
--   vendor_engagement_scope_items.question_version_id
--       which immutable content row this scope item asks. NULL on every row
--       written before P2; the read paths COALESCE to the requirement text for
--       those, so historical engagements render exactly as they always did.
--   requirement_responses.question_version_id
--   requirement_response_revisions.question_version_id
--       which content the vendor was looking at when they answered. Stamped
--       from the scope item at write time, never taken from the caller.
--   vendor_engagements.question_set_hash (+ _at)
--       the content-addressed identity of an ISSUED questionnaire: sha256 over
--       the ordered (content_hash, depth, mandatory) of its scope items. Stamped
--       once at issue — the moment scope freezes — and never rewritten. A later
--       edit to a requirement or a question cannot move it, because the items
--       point at immutable version rows. `GET /vendor-engagements/:id/integrity`
--       recomputes and compares.
--
-- ON DELETE RESTRICT on every version FK: a version an engagement points at
-- cannot be removed (the WORM guard refuses anyway — this is the schema
-- saying the same thing).
--
-- No table is created here, so no RLS/grant/classification work: the columns
-- inherit their tables' policies. The rollback NULLs the stamps and drops the
-- columns; docs/release/ROLLBACK-20261059-20261061.sql.

ALTER TABLE vendor_engagement_scope_items
  ADD COLUMN IF NOT EXISTS question_version_id UUID NULL
    REFERENCES question_versions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_scope_items_version
  ON vendor_engagement_scope_items (question_version_id)
  WHERE question_version_id IS NOT NULL;

ALTER TABLE requirement_responses
  ADD COLUMN IF NOT EXISTS question_version_id UUID NULL
    REFERENCES question_versions(id) ON DELETE RESTRICT;

ALTER TABLE requirement_response_revisions
  ADD COLUMN IF NOT EXISTS question_version_id UUID NULL
    REFERENCES question_versions(id) ON DELETE RESTRICT;

ALTER TABLE vendor_engagements
  ADD COLUMN IF NOT EXISTS question_set_hash TEXT NULL
    CHECK (question_set_hash IS NULL OR question_set_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE vendor_engagements
  ADD COLUMN IF NOT EXISTS question_set_hash_at TIMESTAMPTZ NULL;
