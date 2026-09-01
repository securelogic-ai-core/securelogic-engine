-- Rollback for 20261080 (ADR-0012 Step 2 — evidence validity, supersession,
-- assurance class).
--
-- DESTRUCTIVE: drops the validity window, the version chain and the assurance
-- class from every evidence row. Export before running if any of it has been
-- populated:
--
--   SELECT id, valid_from, valid_until, validity_basis,
--          supersedes_evidence_id, assurance_class
--     FROM evidence
--    WHERE validity_basis <> 'not_established'
--       OR assurance_class <> 'unclassified'
--       OR supersedes_evidence_id IS NOT NULL;
--
-- Run AFTER ROLLBACK-20261081.sql if evidence_links still exists: nothing in
-- this file depends on it, but reversing the package in build order keeps the
-- intermediate states coherent.
--
-- Safe while the package is dark: no counting path reads these columns.

DROP TRIGGER IF EXISTS trg_evidence_supersession_same_org ON evidence;
DROP FUNCTION IF EXISTS evidence_supersession_same_org();

DROP INDEX IF EXISTS idx_evidence_supersession_linear;
DROP INDEX IF EXISTS idx_evidence_org_validity;
DROP INDEX IF EXISTS idx_evidence_org_assurance_class;

ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_validity_basis_check;
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_validity_shape_check;
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_validity_ordering_check;
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_no_self_supersession_check;
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_assurance_class_check;

ALTER TABLE evidence
  DROP COLUMN IF EXISTS valid_from,
  DROP COLUMN IF EXISTS valid_until,
  DROP COLUMN IF EXISTS validity_basis,
  DROP COLUMN IF EXISTS supersedes_evidence_id,
  DROP COLUMN IF EXISTS assurance_class;
