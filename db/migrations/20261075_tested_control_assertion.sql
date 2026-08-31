-- Migration: tested_control_assertion
-- Package:   VA-S4-4C-3 — LAYER 1, the auditor assertion (slot 20261075)
--
-- What the SOURCE says about one tested control, normalized into a closed
-- vocabulary, with the auditor's own words preserved beside it.
--
-- ── This layer must not assert governed effectiveness ──────────────────────
--
-- Owner ruling. A row here says "the auditor stated X about this control". It
-- does NOT say the control is effective, ineffective, or covered. That answer
-- is Layer 2 (20261076), it is made by a named human, and it lives in a
-- different table precisely so that no query can accidentally read one as the
-- other.
--
-- ── EXCEPTION and DEVIATION are terminology, not severity ──────────────────
--
-- Owner ruling, restated in the schema because this is where it would be
-- violated. `EXCEPTION_NOTED` and `DEVIATION_NOTED` are two words auditors use
-- for the same class of finding. The vocabulary is a CHECK over an unordered
-- set, not an enum with an ordinal, and nothing in this schema — no ordering,
-- no comparison, no numeric mapping — permits one to be read as worse than the
-- other. The auditor's own word is preserved separately in `source_term`.
--
-- ── Why materialized, with no human acceptance surface ─────────────────────
--
-- A deliberate asymmetry with Layer 2. Layer 1 is a READING OF THE SOURCE, and
-- it is machine-produced: deterministic, versioned by
-- `normalizer_version`, and always accompanied by `source_text` — the verbatim
-- result — so it can be argued back to the report by anyone at any time.
--
-- Giving it its own acceptance surface would create a SECOND place where a
-- human appears to settle a control's outcome, and the two would drift. A
-- reviewer who disagrees with the normalized reading says so in Layer 2, where
-- authority actually lives, with a note. There is therefore no actor column
-- here, and its absence is the point rather than an omission.
--
-- ── Grain ──────────────────────────────────────────────────────────────────
--
-- ONE row per (extraction, tested control). Deliberately NOT the grain of
-- `vendor_tested_control_resolutions`, which fans out to N rows per control —
-- one per canonical control the crosswalk carries. An assertion is about the
-- vendor's control as tested, not about any canonical control it maps to, and
-- storing it on the resolution rows would duplicate one auditor statement up to
-- eight times and invite them to disagree.
--
-- Append-only: re-materialization supersedes by `superseded_at`, never mutates,
-- exactly as 20261073 does.
--
-- Rollback: docs/release/ROLLBACK-20261075.sql
-- Additive, idempotent, re-runnable.

CREATE TABLE IF NOT EXISTS vendor_tested_control_assertions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id           UUID        NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,
  extraction_id         UUID        NOT NULL REFERENCES vendor_assurance_extractions(id) ON DELETE CASCADE,

  -- The tested-control identity: the same grain 20261072 governs review at and
  -- 20261073 resolves at.
  element_key           TEXT        NOT NULL,

  -- LAYER 1. The auditor's assertion, normalized.
  auditor_assertion     TEXT        NOT NULL,

  -- The auditor's own words, VERBATIM, as at materialization. Never a summary,
  -- never regenerated. Extractions are correctable through overrides; a
  -- normalized value that cannot be checked against the text it came from is
  -- not evidence of anything.
  source_text           TEXT        NULL,

  -- Which of the two produced `source_text`, structurally, so a reader never
  -- has to diff JSON to find out whether a human correction was in play.
  effective_source      TEXT        NOT NULL,
  override_id           UUID        NULL REFERENCES vendor_assurance_field_overrides(id) ON DELETE RESTRICT,

  -- The auditor's own WORD for the finding, when they used one. Preserved
  -- because normalization necessarily loses it, and a report that says
  -- "deviation" should still read as saying "deviation" a year later. Carries
  -- NO severity.
  source_term           TEXT        NULL,

  -- PROVENANCE of the reading itself: which rule fired, why, under which
  -- version of the rules. A past assertion stays arguable against the rules
  -- that produced it rather than against today's.
  normalizer_version    TEXT        NOT NULL,
  normalizer_rule       TEXT        NOT NULL,
  normalizer_reason     TEXT        NOT NULL,

  asserted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at         TIMESTAMPTZ NULL,

  CONSTRAINT vendor_tested_control_assertions_vocabulary_check
    CHECK (auditor_assertion IN (
      'NO_EXCEPTION_NOTED',
      'EXCEPTION_NOTED',
      'DEVIATION_NOTED',
      'NOT_EFFECTIVE_STATED',
      'NOT_TESTED',
      'NOT_APPLICABLE',
      'INCONCLUSIVE',
      'DESIGN_ONLY',
      'NOT_STATED'
    )),

  -- Terminology, when present, is exactly what the auditor wrote. Two values,
  -- unordered.
  CONSTRAINT vendor_tested_control_assertions_source_term_check
    CHECK (source_term IS NULL OR source_term IN ('exception', 'deviation')),

  CONSTRAINT vendor_tested_control_assertions_effective_source_check
    CHECK (effective_source IN ('extraction', 'field_override')),

  CONSTRAINT vendor_tested_control_assertions_override_provenance_check
    CHECK (
      (effective_source = 'field_override' AND override_id IS NOT NULL)
      OR
      (effective_source = 'extraction'     AND override_id IS NULL)
    ),

  -- NOT_STATED is the ONLY assertion permitted to have no source text, and it is
  -- required to have none: every other value claims to have READ something, and
  -- a reading with nothing behind it is the failure mode this table exists to
  -- make impossible.
  CONSTRAINT vendor_tested_control_assertions_source_text_check
    CHECK (
      (auditor_assertion = 'NOT_STATED')
      OR
      (source_text IS NOT NULL AND length(trim(source_text)) > 0)
    ),

  CONSTRAINT vendor_tested_control_assertions_element_key_nonempty
    CHECK (length(trim(element_key)) > 0)
);

-- One LIVE assertion per (extraction, tested control). No fan-out here: an
-- auditor makes one statement about one control.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_tested_control_assertions_live
  ON vendor_tested_control_assertions (extraction_id, element_key)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_tested_control_assertions_document
  ON vendor_tested_control_assertions (organization_id, document_id, asserted_at DESC);

ALTER TABLE vendor_tested_control_assertions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_tested_control_assertions_tenant_isolation
  ON vendor_tested_control_assertions;
CREATE POLICY vendor_tested_control_assertions_tenant_isolation
  ON vendor_tested_control_assertions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_tested_control_assertions TO app_request;
  END IF;
END
$$;

COMMENT ON TABLE vendor_tested_control_assertions IS
  'VA-S4-4C-3 LAYER 1. What the AUDITOR asserted about one tested control, '
  'normalized into a closed vocabulary with the verbatim result preserved. '
  'Machine-produced and carrying NO human authority by design — a reviewer who '
  'disagrees says so in Layer 2 (vendor_tested_control_effectiveness), which is '
  'where authority lives. This table MUST NOT be read as SecureLogic-governed '
  'control effectiveness, nor as coverage. Append-only: superseded, never '
  'mutated.';

COMMENT ON COLUMN vendor_tested_control_assertions.auditor_assertion IS
  'The SOURCE''s assertion, not SecureLogic''s conclusion. EXCEPTION_NOTED and '
  'DEVIATION_NOTED are REPORT TERMINOLOGY and carry NO severity ordering '
  'relative to one another — the vocabulary is an unordered set and nothing may '
  'rank it. NOT_STATED is both the "report said nothing" value and the '
  'fail-closed value for text the normalizer cannot read: an unreadable result '
  'must never become NO_EXCEPTION_NOTED.';

COMMENT ON COLUMN vendor_tested_control_assertions.source_term IS
  'The auditor''s own word for the finding — ''exception'' or ''deviation'' — '
  'preserved because normalization loses it. Carries NO severity. Nothing may '
  'infer that one is worse than the other.';
