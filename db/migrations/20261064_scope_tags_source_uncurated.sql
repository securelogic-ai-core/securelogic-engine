-- Migration: scope_tags_source_uncurated
-- Package:   VA-Q2 corpus curation — curated framework tags (slot 20261064)
--
-- Adds a third value to `requirements.scope_tags_source`: 'uncurated'.
--
-- ── The defect ──────────────────────────────────────────────────────────────
--
-- `core` is simultaneously a real classification (the tier-4 baseline every
-- vendor is asked) AND the fallback the tagger applies when no pattern matched.
-- So two very different rows were stored identically:
--
--   * a requirement a human classified as baseline security, and
--   * a requirement NOBODY has classified, which is being asked as a security
--     question because a keyword regex found nothing in its title.
--
-- Measured on the shipped GDPR / CCPA / NIST AI RMF templates, 11 of 24
-- requirements were in the second category — including all four NIST AI RMF
-- functions, which meant activating the AI-governance framework produced an
-- EMPTY AI question set and four extra security questions.
--
-- The fallback itself is correct and stays: an untagged requirement is invisible
-- to every tier below 1, and invisible is the one outcome with no reviewer-
-- facing trace. What ends here is claiming the fallback was a decision.
--
-- ── Additive and reversible ─────────────────────────────────────────────────
--
-- One CHECK constraint widened. No column added, no data rewritten, no policy
-- or grant touched. Widening a CHECK cannot invalidate an existing row: every
-- current value ('heuristic', 'curated', NULL) remains legal.
--
-- Reclassifying existing rows is deliberately NOT done here. Deciding whether a
-- historical row was a fallback requires re-deriving it through the SAME
-- heuristic the application uses, and this file is the third place that logic
-- would have to live (after the module and the 20260926 backfill). It is done
-- instead by `scripts/backfill-curated-framework-tags.ts`, which imports the
-- module and therefore cannot drift from it. Until that script runs, existing
-- rows keep saying 'heuristic' — understated, never wrong.
--
-- Rollback: docs/release/ROLLBACK-20261064.sql
--
-- Idempotent and re-runnable.

ALTER TABLE requirements
  DROP CONSTRAINT IF EXISTS requirements_scope_tags_source_check;

ALTER TABLE requirements
  ADD CONSTRAINT requirements_scope_tags_source_check CHECK (
    scope_tags_source IS NULL
    OR scope_tags_source IN ('heuristic', 'curated', 'uncurated')
  );

COMMENT ON COLUMN requirements.scope_tags_source IS
  '''curated'' = a human stood behind these tags (version-controlled reference '
  'data in curatedFrameworkTags.ts, or a PATCH through the curation route). '
  '''heuristic'' = a keyword pattern in requirementScopeTags.ts matched the '
  'title. ''uncurated'' = nothing matched; the row carries ''core'' because the '
  'fallback put it there, NOT because anyone classified it as baseline '
  'security. Re-running any backfill never overwrites ''curated''.';
