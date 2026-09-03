-- Migration: assurance_opinion
-- Package:   VA-S4 Step 4 — auditor-opinion normalisation (slot 20261066)
--
-- Owner ruling 4, 2026-08-29: a free-text auditor opinion MUST NOT be an
-- assurance eligibility gate. Use a controlled semantic vocabulary, and a
-- qualified opinion is not automatically unusable — it may contribute coverage
-- only where the exception is demonstrably unrelated to the mapped control,
-- and FAILS CLOSED otherwise.
--
-- ── Why free text cannot be the gate ────────────────────────────────────────
--
-- Every extraction on staging reads, verbatim:
--
--   "Unqualified opinion, except for the specific deviations and exception
--    described in Section IV"
--
-- `LIKE '%Unqualified%'` returns TRUE on that. It is a QUALIFIED opinion. A
-- string test on model-extracted prose is not a control; it is a coin flip that
-- happens to be right sometimes.
--
-- ── The vocabulary ─────────────────────────────────────────────────────────
--
-- Five values, chosen to distinguish materially different assurance outcomes:
--
--   unmodified     clean / unqualified, no exceptions bearing on the opinion
--   qualified      clean EXCEPT for identified matters
--   adverse        the auditor concludes controls did NOT operate effectively
--   disclaimer     the auditor is unable to form an opinion
--   not_evaluated  no opinion has been established (the default, and NOT a
--                  synonym for "clean" — absence is never coverage)
--
-- No equivalent vocabulary exists in the model; this was checked against every
-- CHECK constraint before adding one. `evidence_analysis.verdict`
-- (supports/insufficient/contradicts/unreadable) is a per-ARTIFACT advisory AI
-- verdict about one control, not a report-level opinion, and is a different
-- level and a different authority.
--
-- ── Authority ───────────────────────────────────────────────────────────────
--
-- The opinion is NULL until a human accepts one. The CHECK below makes that
-- structural rather than conventional: an opinion cannot exist without an
-- acceptor and a timestamp. A model may PROPOSE (see assuranceOpinion.ts,
-- which is pure and returns a candidate marked `requires_human`), and the
-- proposal is never written here by anything but the governed accept.
--
-- `assurance_opinion_note` retains the verbatim source text AS IT WAS at
-- acceptance, so the normalised value can always be argued back to what the
-- report actually said. Extractions are mutable; this is not.
--
-- Rollback: docs/release/ROLLBACK-20261066.sql
-- Additive, idempotent, re-runnable. No data rewritten.

ALTER TABLE vendor_assurance_documents
  ADD COLUMN IF NOT EXISTS assurance_opinion                     TEXT        NULL,
  ADD COLUMN IF NOT EXISTS assurance_opinion_note                TEXT        NULL,
  ADD COLUMN IF NOT EXISTS assurance_opinion_accepted_by_user_id UUID        NULL
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assurance_opinion_accepted_at         TIMESTAMPTZ NULL;

ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_assurance_opinion_check;
ALTER TABLE vendor_assurance_documents
  ADD CONSTRAINT vendor_assurance_documents_assurance_opinion_check CHECK (
    assurance_opinion IS NULL
    OR assurance_opinion IN ('unmodified', 'qualified', 'adverse', 'disclaimer', 'not_evaluated')
  );

-- Authority is structural: no opinion without a human acceptor and a time.
ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_assurance_opinion_authority_check;
ALTER TABLE vendor_assurance_documents
  ADD CONSTRAINT vendor_assurance_documents_assurance_opinion_authority_check CHECK (
    (assurance_opinion IS NULL     AND assurance_opinion_accepted_at IS NULL)
    OR
    (assurance_opinion IS NOT NULL AND assurance_opinion_accepted_at IS NOT NULL
                                   AND assurance_opinion_accepted_by_user_id IS NOT NULL)
  );

COMMENT ON COLUMN vendor_assurance_documents.assurance_opinion IS
  'The ACCEPTED report-level assurance opinion, from a closed vocabulary '
  '(unmodified | qualified | adverse | disclaimer | not_evaluated). NULL until a '
  'human accepts one — a CHECK enforces that an opinion cannot exist without an '
  'acceptor. A model may PROPOSE a candidate (assuranceOpinion.ts) and may never '
  'write this column. `not_evaluated` is NOT a synonym for clean: absence of an '
  'opinion is never coverage.';

COMMENT ON COLUMN vendor_assurance_documents.assurance_opinion_note IS
  'The verbatim opinion text AS IT WAS when the opinion was accepted. '
  'Extractions are mutable and re-extraction can move them; this is the record '
  'that lets a normalised value be argued back to what the report said.';
