-- ROLLBACK for 20261066_assurance_opinion (VA-S4 Step 4).
--
-- Code rollback alone is sufficient: nothing reads these columns yet — S4 is not
-- wired, and the normalizer is a pure proposal function with no write path. Run
-- this only if the schema itself must go.
--
-- DATA LOSS: drops every accepted assurance opinion and the verbatim note it was
-- accepted against. Those are human governance decisions and are NOT
-- reconstructible from the extraction, which is mutable. Snapshot first:
--   COPY (SELECT id, assurance_opinion, assurance_opinion_note,
--                assurance_opinion_accepted_by_user_id, assurance_opinion_accepted_at
--           FROM vendor_assurance_documents WHERE assurance_opinion IS NOT NULL)
--     TO '/tmp/assurance_opinions.csv' CSV HEADER;
--
-- Idempotent.

ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_assurance_opinion_authority_check;
ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_assurance_opinion_check;

ALTER TABLE vendor_assurance_documents
  DROP COLUMN IF EXISTS assurance_opinion_accepted_at,
  DROP COLUMN IF EXISTS assurance_opinion_accepted_by_user_id,
  DROP COLUMN IF EXISTS assurance_opinion_note,
  DROP COLUMN IF EXISTS assurance_opinion;
