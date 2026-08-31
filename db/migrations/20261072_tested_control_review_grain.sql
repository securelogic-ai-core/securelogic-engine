-- Migration: tested_control_review_grain
-- Package:   S4-4C-0 — evidence authority repair (slot 20261072)
--
-- Owner rulings, 2026-08-31. Three findings, one repair.
--
-- ── The authority regression ────────────────────────────────────────────────
--
-- The LEGACY `finalize` route required a current review decision on every
-- material extracted field (computeFinalizePrecondition). The CURRENT `approve`
-- route — ruled the terminal assurance-eligible state, and the state the S4
-- predicate keys on — requires NONE. The state that replaced finalize dropped
-- its human-confirmation gate, so `approved` currently asserts LESS than the
-- state it replaced while S4 treats it as authoritative.
--
-- Measured on staging before writing this: `vendor_assurance_review_decisions`
-- and `vendor_assurance_field_overrides` are BOTH EMPTY estate-wide. Not one
-- extracted field has ever been human-reviewed. Both `approved` documents were
-- approved with zero review decisions.
--
-- ── Why the review grain has to change ──────────────────────────────────────
--
-- Review decisions are keyed by `field_name`, so a reviewer accepts the whole
-- `controls` ARRAY as one indivisible decision. S4 will reason about each
-- tested control INDEPENDENTLY — a fan-out of up to 5 requirements per control,
-- each needing its own sufficiency determination — so five extracted controls
-- cannot be one governance decision.
--
-- This adds the element grain to the EXISTING append-only review model rather
-- than building a second one:
--
--   element_key = NULL  → a whole-field decision. Exactly today's behaviour,
--                         unchanged, and still what the other 13 fields use.
--   element_key = 'CC6.1' → a decision about ONE tested control.
--
-- ── Why the KEY and not the index ───────────────────────────────────────────
--
-- An array index is invalidated by a `controls` field override, which would
-- silently re-point a governance decision at a different control. The extracted
-- control identifier is the identity the whole S4 chain already uses
-- (TSC criterion -> canonical control -> requirement), and it is unique within
-- every document in the corpus: 25 tested controls across 5 documents, 5
-- distinct ids each (CC6.1, CC6.2, CC7.2, A1.2, C1.1).
--
-- If the array is later replaced, decisions for keys that no longer exist stay
-- as history and any new key is simply unreviewed — observable, and fail-closed
-- against the approval gate.
--
-- ── Provenance that survives ────────────────────────────────────────────────
--
-- `element_snapshot` records the ORIGINAL extracted element BY VALUE at the
-- moment of the decision: identifier, description, test procedure and the
-- verbatim result. Extractions are mutable through field overrides; a
-- governance decision must remain explainable against what the reviewer
-- actually saw. Same discipline as `assurance_opinion_basis` (20261070) and
-- `vendor_assurance_cuecs.gap_basis`.
--
-- NOT added here: per-element SOURCE SPANS. `vendor_assurance_extraction_spans`
-- is field-grained and `controls` has requiresSourceSpan=false, so it carries
-- ZERO spans today; there is also no re-extraction flow
-- (vendor_assurance_extractions_one_per_document, "a failed document requires
-- re-upload"), so spans cannot be retro-fitted to existing extractions at all.
-- Emitting per-control spans needs a prompt + validator change for FUTURE
-- uploads. That is a separate decision and no speculative column is added for
-- it here.
--
-- ── Scope ───────────────────────────────────────────────────────────────────
--
-- Element review is deliberately restricted to `controls` by CHECK. The ruling
-- says not to generalise element-level review across every extraction field
-- unless needed; `controls` is the only structure whose ELEMENTS become
-- individually authoritative.
--
-- Rollback: docs/release/ROLLBACK-20261072.sql
-- Additive, idempotent, re-runnable. No data rewritten, no historical review
-- decision altered or fabricated.

ALTER TABLE vendor_assurance_review_decisions
  ADD COLUMN IF NOT EXISTS element_key      TEXT  NULL,
  ADD COLUMN IF NOT EXISTS element_snapshot JSONB NULL;

-- Element review is only meaningful for assurance-bearing structures.
ALTER TABLE vendor_assurance_review_decisions
  DROP CONSTRAINT IF EXISTS vendor_assurance_review_decisions_element_scope_check;
ALTER TABLE vendor_assurance_review_decisions
  ADD CONSTRAINT vendor_assurance_review_decisions_element_scope_check CHECK (
    element_key IS NULL OR field_name = 'controls'
  );

-- An element decision must say WHAT it decided about, by value.
ALTER TABLE vendor_assurance_review_decisions
  DROP CONSTRAINT IF EXISTS vendor_assurance_review_decisions_element_snapshot_check;
ALTER TABLE vendor_assurance_review_decisions
  ADD CONSTRAINT vendor_assurance_review_decisions_element_snapshot_check CHECK (
    (element_key IS NULL     AND element_snapshot IS NULL)
    OR
    (element_key IS NOT NULL AND element_snapshot IS NOT NULL AND length(trim(element_key)) > 0)
  );

-- The current-decision-per-element projection, mirroring the existing
-- per-field one: DISTINCT ON (field_name, element_key)
-- ORDER BY (..., decided_at DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_vendor_assurance_review_decisions_element_projection
  ON vendor_assurance_review_decisions
     (organization_id, extraction_id, field_name, element_key, decided_at DESC, id DESC);

COMMENT ON COLUMN vendor_assurance_review_decisions.element_key IS
  'NULL for a whole-field decision (unchanged legacy behaviour). For `controls`, '
  'the EXTRACTED control identifier (e.g. CC6.1) that this decision is about. '
  'Keyed by identifier rather than array index because an index is invalidated '
  'by a field override, which would silently re-point a governance decision at a '
  'different control.';

COMMENT ON COLUMN vendor_assurance_review_decisions.element_snapshot IS
  'The ORIGINAL extracted element, by value, at the moment of the decision — '
  'identifier, description, test procedure, verbatim result. Extractions are '
  'mutable; a governance decision must stay explainable against what the '
  'reviewer actually saw.';
