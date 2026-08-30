-- ROLLBACK for 20261070_assurance_opinion_basis (VA-S4-P2, step 4b).
--
-- Code rollback alone is sufficient in most cases: nothing outside the
-- acceptance route reads these columns, S4 is still unwired, and no scope,
-- score or finding depends on an accepted opinion.
--
-- DATA LOSS: drops the decision-basis snapshot and the reviewer's own words for
-- every accepted assurance opinion. The basis is NOT reconstructible — it
-- records the source text and the normalizer candidate AS THEY WERE at
-- acceptance, and extractions are mutable. Snapshot first:
--   COPY (SELECT id, organization_id, assurance_opinion,
--                assurance_opinion_reviewer_note, assurance_opinion_basis,
--                assurance_opinion_accepted_by_user_id, assurance_opinion_accepted_at
--           FROM vendor_assurance_documents WHERE assurance_opinion IS NOT NULL)
--     TO '/tmp/assurance_opinion_basis.csv' CSV HEADER;
--
-- ORDER MATTERS. The authority CHECK must be restored to its 20261066 form
-- BEFORE the columns are dropped, otherwise the constraint references a column
-- that no longer exists.
--
-- Idempotent.

ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_assurance_opinion_authority_check;

-- Restore the 20261066 authority CHECK (acceptor + timestamp, no basis).
ALTER TABLE vendor_assurance_documents
  ADD CONSTRAINT vendor_assurance_documents_assurance_opinion_authority_check CHECK (
    (assurance_opinion IS NULL     AND assurance_opinion_accepted_at IS NULL)
    OR
    (assurance_opinion IS NOT NULL AND assurance_opinion_accepted_at IS NOT NULL
                                   AND assurance_opinion_accepted_by_user_id IS NOT NULL)
  );

ALTER TABLE vendor_assurance_documents
  DROP COLUMN IF EXISTS assurance_opinion_basis,
  DROP COLUMN IF EXISTS assurance_opinion_reviewer_note;
