-- ROLLBACK for 20261064_scope_tags_source_uncurated (VA-Q2 corpus curation).
--
-- Code rollback (redeploy the previous SHA) is NOT sufficient on its own IF the
-- new code has already written any 'uncurated' row, because the old CHECK does
-- not permit that value: a later UPDATE touching such a row would fail. So the
-- order matters.
--
--   1. Redeploy the previous SHA (stops new 'uncurated' writes).
--   2. Run this file (folds the value back to 'heuristic', re-narrows the CHECK).
--
-- Running step 2 before step 1 leaves the application writing a value the CHECK
-- rejects, and framework activation starts returning 500s.
--
-- INFORMATION LOSS, not data loss: folding 'uncurated' back into 'heuristic'
-- restores exactly the pre-migration state — a row that nothing classified,
-- claiming a heuristic decided it. That is the defect this migration exists to
-- fix, and reverting reinstates it. Curated rows are never touched.
--
-- The curated TAGS themselves survive a rollback: they are stamped 'curated',
-- which the old CHECK already permits. Only the unknown/known distinction goes.
--
-- Every step is idempotent.

-- 1. Fold the third value back into the second. Nothing else wrote 'uncurated'.
UPDATE requirements
   SET scope_tags_source = 'heuristic'
 WHERE scope_tags_source = 'uncurated';

-- 2. Re-narrow the CHECK to the original two values.
ALTER TABLE requirements
  DROP CONSTRAINT IF EXISTS requirements_scope_tags_source_check;

ALTER TABLE requirements
  ADD CONSTRAINT requirements_scope_tags_source_check CHECK (
    scope_tags_source IS NULL OR scope_tags_source IN ('heuristic', 'curated')
  );

-- 3. Restore the original column comment (20260926).
COMMENT ON COLUMN requirements.scope_tags_source IS
  '''heuristic'' = derived from the title by the backfill. ''curated'' = a human '
  'stood behind it. Re-running the backfill never overwrites ''curated''.';
