-- Migration: vendor_tested_control_resolution
-- Package:   VA-S4-4C-2 — vendor tested-control resolution (slot 20261073)
--
-- 4C-1 published the governed SOC 2 / 2017 crosswalk, so a tested control's TSC
-- criterion CAN now reach a canonical control. This is the RECORD of that
-- resolution actually having happened, for a specific document, against a
-- specific governed mapping, at a specific time.
--
-- ── Why a record and not a view ────────────────────────────────────────────
--
-- Every input is mutable in a way the answer must survive:
--
--   - the crosswalk is versioned and supersedable, so the mapping consulted
--     today is not necessarily the mapping a view would compute tomorrow;
--   - the tested control itself is correctable through a field override;
--   - the corpus of canonical controls is itself curated content.
--
-- A view would silently re-answer an old question with new content. The record
-- binds the answer to the evidence and the mapping that produced it, the same
-- discipline as `assurance_opinion_basis` (20261070) and the element snapshots
-- of 20261072.
--
-- ── ORIGINAL EXTRACTION vs GOVERNED EFFECTIVE VALUE ────────────────────────
--
-- Owner ruling: resolution must use the GOVERNED EFFECTIVE tested control, not
-- only the immutable model extraction, when an accepted human override has
-- corrected it. Both are preserved, side by side, and neither is mutated:
--
--   original_control  — the model's extracted control, by value, in the
--                       extraction's own words. NULL only when an override
--                       INTRODUCED a control the extraction never contained.
--   effective_control — what governance says the control IS at resolution time:
--                       the override's value when one is live, else identical
--                       to the original.
--   effective_source  — which of the two produced it, structurally, so a reader
--                       never has to diff two JSON blobs to find out.
--   override_id       — the exact override row, when one applied.
--
-- Measured before writing this: `vendor_assurance_field_overrides` is EMPTY
-- estate-wide, so the override arm has no production data behind it yet and is
-- exercised by fixtures. It is built now because 4C-0 measured the trap it
-- closes — overrides are append-only BESIDE the extraction and never rewrite
-- `vendor_assurance_extractions.fields`, so anything reading only `fields`
-- silently ignores every human correction ever made.
--
-- A control the extraction had and an override REMOVED is not a tested control
-- any more: it gets no live resolution row, and any prior one is superseded.
-- Removal is a governance act with an effect, not a row to preserve as current.
--
-- ── RESOLVED / UNMAPPED. There is deliberately no AMBIGUOUS ────────────────
--
-- One TSC criterion mapping to many canonical controls is FAN-OUT, not
-- ambiguity: the crosswalk is many-to-many by design and CC6.1 legitimately
-- carries eight canonical controls. Fan-out is recorded as N rows, every one of
-- them `resolved`. Inventing an `ambiguous` state for it would label correct
-- content as a defect.
--
-- A genuine ambiguity would need two DIFFERENT governed answers to the same
-- question with no rule to choose between them. The mapping architecture
-- cannot produce one: `idx_canonical_control_crosswalk_live_unique` makes
-- (framework, version, reference, canonical control) unique among live rows, so
-- a criterion cannot hold two conflicting live mappings to the same control,
-- and different controls are fan-out. If that ever changes, the state is added
-- WITH its decision rule, not before.
--
-- ── What a resolution row does NOT assert ──────────────────────────────────
--
-- It asserts that a vendor's tested control carries a valid canonical identity
-- which a governed mapping connects to a canonical control. It asserts NOTHING
-- about tenant applicability, requirement applicability, evidence sufficiency,
-- control effectiveness, questionnaire suppression or residual risk. Those are
-- downstream governed determinations and no consumer may read this table as
-- coverage.
--
-- Rollback: docs/release/ROLLBACK-20261073.sql
-- Additive, idempotent, re-runnable. No existing row is read or rewritten.

CREATE TABLE IF NOT EXISTS vendor_tested_control_resolutions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id             UUID        NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,
  extraction_id           UUID        NOT NULL REFERENCES vendor_assurance_extractions(id) ON DELETE CASCADE,

  -- The tested-control identity, the SAME grain 20261072 governs review at.
  element_key             TEXT        NOT NULL,

  -- NULL only when a human override INTRODUCED a control the extraction never
  -- contained: that control has no original, and NOT NULL would force the row
  -- to assert a model extraction that never happened.
  original_control        JSONB       NULL,
  effective_control       JSONB       NOT NULL,
  effective_source        TEXT        NOT NULL,
  override_id             UUID        NULL REFERENCES vendor_assurance_field_overrides(id) ON DELETE RESTRICT,

  -- The canonical framework identity resolution was performed AGAINST. Recorded
  -- rather than assumed: a SOC 1 report must never silently resolve against the
  -- SOC 2 criteria.
  framework_key           TEXT        NOT NULL,
  framework_version       TEXT        NOT NULL,
  requirement_reference   TEXT        NOT NULL,

  canonical_control_id    UUID        NULL REFERENCES canonical_controls(id) ON DELETE RESTRICT,

  -- PROVENANCE: the exact governed crosswalk row consulted, plus its own
  -- provenance snapshotted, so the answer stays explainable if that row is
  -- later superseded.
  crosswalk_id            UUID        NULL REFERENCES canonical_control_crosswalk(id) ON DELETE RESTRICT,
  mapping_version         TEXT        NULL,
  mapping_source          TEXT        NULL,

  resolution_state        TEXT        NOT NULL,
  unmapped_reason         TEXT        NULL,

  resolved_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at           TIMESTAMPTZ NULL,

  CONSTRAINT vendor_tested_control_resolutions_state_check
    CHECK (resolution_state IN ('resolved', 'unmapped')),

  CONSTRAINT vendor_tested_control_resolutions_effective_source_check
    CHECK (effective_source IN ('extraction', 'field_override')),

  -- An override-sourced effective value must name the override it came from,
  -- and an extraction-sourced one must not pretend to have had one.
  CONSTRAINT vendor_tested_control_resolutions_override_provenance_check
    CHECK (
      (effective_source = 'field_override' AND override_id IS NOT NULL)
      OR
      (effective_source = 'extraction'     AND override_id IS NULL)
    ),

  -- THE AUTHORITY SHAPE. A resolved row must name BOTH the canonical control
  -- and the governed mapping row that justified it; an unmapped row must name
  -- neither and must say why. There is no third shape.
  CONSTRAINT vendor_tested_control_resolutions_state_shape_check
    CHECK (
      (resolution_state = 'resolved'
        AND canonical_control_id IS NOT NULL
        AND crosswalk_id IS NOT NULL
        AND mapping_version IS NOT NULL
        AND unmapped_reason IS NULL)
      OR
      (resolution_state = 'unmapped'
        AND canonical_control_id IS NULL
        AND crosswalk_id IS NULL
        AND mapping_version IS NULL
        AND unmapped_reason IS NOT NULL)
    ),

  -- ONE reason, because one reason is reachable. A control with no identifier
  -- cannot be recorded here at all (element_key is NOT NULL and an array index
  -- is not an identity), and 20261072 already refuses to approve a document
  -- containing one; the materializer counts and surfaces them instead of
  -- inventing a key. A vocabulary value no writer can ever produce is a defect
  -- this repository has already shipped once — the CUEC `review_status`
  -- `'accepted'` that no row could hold — and it is not repeated here.
  CONSTRAINT vendor_tested_control_resolutions_unmapped_reason_check
    CHECK (
      unmapped_reason IS NULL
      OR unmapped_reason IN ('no_published_crosswalk_mapping')
    ),

  -- An extraction-sourced effective value must have its original, and the two
  -- must be the same value: 'extraction' means nothing overrode it.
  CONSTRAINT vendor_tested_control_resolutions_original_presence_check
    CHECK (
      original_control IS NOT NULL
      OR effective_source = 'field_override'
    ),

  CONSTRAINT vendor_tested_control_resolutions_element_key_nonempty
    CHECK (length(trim(element_key)) > 0)
);

-- One LIVE resolved row per (extraction, tested control, canonical control).
-- Fan-out is many rows under one element_key and is expected; the same pair
-- twice is not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_tested_control_resolutions_live_resolved
  ON vendor_tested_control_resolutions (extraction_id, element_key, canonical_control_id)
  WHERE superseded_at IS NULL AND resolution_state = 'resolved';

-- A separate index for the unmapped shape: canonical_control_id is NULL there,
-- and NULLs do not collide in a unique index, so without this an unmapped
-- control could be recorded unmapped many times over.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_tested_control_resolutions_live_unmapped
  ON vendor_tested_control_resolutions (extraction_id, element_key)
  WHERE superseded_at IS NULL AND resolution_state = 'unmapped';

CREATE INDEX IF NOT EXISTS idx_vendor_tested_control_resolutions_document
  ON vendor_tested_control_resolutions (organization_id, document_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_tested_control_resolutions_control
  ON vendor_tested_control_resolutions (canonical_control_id)
  WHERE superseded_at IS NULL AND resolution_state = 'resolved';

ALTER TABLE vendor_tested_control_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_tested_control_resolutions_tenant_isolation
  ON vendor_tested_control_resolutions;
CREATE POLICY vendor_tested_control_resolutions_tenant_isolation
  ON vendor_tested_control_resolutions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_tested_control_resolutions TO app_request;
  END IF;
END
$$;

COMMENT ON TABLE vendor_tested_control_resolutions IS
  'VA-S4-4C-2. One row per (tested control, canonical control) resolution of a '
  'vendor assurance document, against the governed canonical crosswalk. '
  'Append-only: re-resolution supersedes rather than mutates. Records the '
  'GOVERNED EFFECTIVE tested control alongside the original extraction. '
  'Asserts canonical identity and mapping ONLY — never applicability, evidence '
  'sufficiency, control effectiveness or coverage.';

COMMENT ON COLUMN vendor_tested_control_resolutions.effective_control IS
  'The governed effective tested control BY VALUE: the live field override''s '
  'value when one exists, else the original extraction''s. Overrides are '
  'append-only beside the extraction and never rewrite '
  'vendor_assurance_extractions.fields, so reading `fields` alone would ignore '
  'every human correction ever made.';

COMMENT ON COLUMN vendor_tested_control_resolutions.resolution_state IS
  '''resolved'' or ''unmapped''. There is deliberately no ''ambiguous'': one '
  'criterion mapping to many canonical controls is FAN-OUT (N resolved rows), '
  'and the live-unique index makes two conflicting mappings to the same control '
  'impossible.';
