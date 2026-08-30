-- Migration: assurance_opinion_basis
-- Package:   VA-S4-P2 / wiring-plan step 4b — the governed opinion ACCEPTANCE
--            surface (slot 20261070)
--
-- 20261066 shipped the vocabulary, the coverage gate, the proposal normalizer
-- and an authority CHECK making an opinion without a named acceptor
-- structurally impossible. It shipped NO WRITER: `assurance_opinion` appeared
-- in exactly two files, neither of which could set it. S4-P1 measured the
-- consequence — no row has ever reached the opinion hop.
--
-- This migration adds what a governed acceptance must record BESIDES the value,
-- and makes recording it structural rather than conventional.
--
-- ── Why two more columns and not a JSONB blob in the note ───────────────────
--
-- `assurance_opinion_note` already has a defined meaning that is load-bearing:
-- the VERBATIM SOURCE TEXT as it stood at acceptance, so a normalised value can
-- always be argued back to what the report actually said. Extractions are
-- mutable; that snapshot is not. Overloading it with the reviewer's own words
-- would destroy the one property it exists to have.
--
-- So the reviewer's statement gets its own column, and the machine-checkable
-- provenance gets a third:
--
--   assurance_opinion_reviewer_note  the human's own words, verbatim. Required
--                                    when the accepted value DIFFERS from the
--                                    normalizer's candidate, and on any explicit
--                                    re-decision. A person overriding a
--                                    deterministic rule must say why.
--
--   assurance_opinion_basis          the decision-basis snapshot, BY VALUE:
--                                    the source text, the candidate the
--                                    normalizer proposed and the rule that
--                                    fired, the normalizer version, whether the
--                                    human agreed or overrode it, the document
--                                    state at acceptance, and — on a
--                                    re-decision — the acceptance it replaced.
--
-- Snapshotting BY VALUE follows `vendor_assurance_cuecs.gap_basis` (VA-1) for
-- the same reason: recomputing a past determination against today's extraction
-- silently rewrites what the reviewer actually saw.
--
-- ── The basis is REQUIRED, by CHECK ─────────────────────────────────────────
--
-- The authority CHECK is extended: an accepted opinion must carry an acceptor,
-- a timestamp AND a basis. An opinion whose provenance was not recorded cannot
-- be defended to an auditor, so it must not be creatable. Safe to tighten:
-- there are zero accepted opinions in any environment (no writer has ever
-- existed), verified before writing this.
--
-- ── What this migration does NOT do ─────────────────────────────────────────
--
-- Owner ruling, 2026-08-30: accepting a report-level opinion MUST NOT itself
-- establish requirement coverage, reduce questionnaire depth, change residual
-- risk, override a control exception, or override contradictory evidence. No
-- column here is read by the scope resolver, and S4 remains unwired:
-- `assuranceCoveredRequirementIds` still has zero production callers.
--
-- Rollback: docs/release/ROLLBACK-20261070.sql
-- Additive, idempotent, re-runnable. No data rewritten.

ALTER TABLE vendor_assurance_documents
  ADD COLUMN IF NOT EXISTS assurance_opinion_reviewer_note TEXT  NULL,
  ADD COLUMN IF NOT EXISTS assurance_opinion_basis         JSONB NULL;

-- Authority is structural: no opinion without a human acceptor, a time, AND a
-- recorded basis. Supersedes the 20261066 form of this constraint.
ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_assurance_opinion_authority_check;
ALTER TABLE vendor_assurance_documents
  ADD CONSTRAINT vendor_assurance_documents_assurance_opinion_authority_check CHECK (
    (assurance_opinion IS NULL     AND assurance_opinion_accepted_at IS NULL
                                   AND assurance_opinion_basis IS NULL)
    OR
    (assurance_opinion IS NOT NULL AND assurance_opinion_accepted_at IS NOT NULL
                                   AND assurance_opinion_accepted_by_user_id IS NOT NULL
                                   AND assurance_opinion_basis IS NOT NULL)
  );

COMMENT ON COLUMN vendor_assurance_documents.assurance_opinion_reviewer_note IS
  'The accepting reviewer''s OWN words, verbatim. Distinct from '
  'assurance_opinion_note, which holds the report''s source text as at '
  'acceptance. Required when the accepted value differs from the normalizer''s '
  'candidate, and on any explicit re-decision.';

COMMENT ON COLUMN vendor_assurance_documents.assurance_opinion_basis IS
  'Decision-basis snapshot taken BY VALUE at acceptance: source text, proposed '
  'candidate + rule + normalizer version, agreement or override, document state, '
  'and the prior acceptance on a re-decision. Required by the authority CHECK — '
  'an opinion whose provenance was not recorded cannot be defended, so it cannot '
  'be created. Never recomputed: extractions are mutable, this is not.';
