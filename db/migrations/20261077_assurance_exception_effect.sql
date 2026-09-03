-- Migration: assurance_exception_effect
-- Package:   VA-S4-4C-3 — LAYER 3, exception identity, linkage and effect
--            (slot 20261077)
--
-- ── Why exceptions need an identity at all ─────────────────────────────────
--
-- Measured in the corpus on 2026-08-31, and this is the finding that reshaped
-- the whole package. The pre-v3 extraction contract gave an exception NO
-- identifier — only `control_id`, `description`, `auditor_assessment`. A
-- management response therefore had nothing to point at except a control, and
-- its field was called `exception_ref`. Given a report that labels its
-- exceptions, the model does the only honest thing available to it and writes:
--
--     management_responses[0].exception_ref = "Exception 1"
--
-- That is an EXCEPTION LABEL in a field the export layer reads as a CONTROL
-- IDENTIFIER. Renaming the field to `control_ref` — the bounded correction
-- originally authorized — would have moved the ambiguity into a differently
-- named field rather than removing it. So an exception gets an identity here,
-- and `exception_ref` keeps its name and finally means what it says.
--
-- ── Why the linkage is a separate table ────────────────────────────────────
--
-- Same corpus, same document:
--
--     exceptions[0].control_id = "CC6.1, CC6.2, CC6.3"
--
-- One identity-governance outage spanning THREE tested controls, packed into a
-- scalar because the contract had nowhere else to put it. That string matches
-- no `element_key`, so 20261073's identifier keying cannot see it at all, and
-- the exception silently fails to reach any of the three controls it concerns.
--
-- Exception-to-control is genuinely many-to-many — one exception across several
-- controls, and several exceptions against one control, both witnessed — so it
-- gets a link table. A scalar cannot express it and a comma-joined string is not
-- a data model.
--
-- ── No heuristic may silently link ─────────────────────────────────────────
--
-- Owner ruling 4. Every link records `link_source` and the exact `source_value`
-- it was read out of, so a reader can always check a link rather than trust it.
-- The vocabulary is:
--
--   extraction_control_refs — the corrected contract's explicit array.
--   legacy_control_id       — the pre-v3 scalar, retained so historical
--                             extractions stay readable. When it packed several
--                             identifiers into one string, the raw string is
--                             kept verbatim so the split is inspectable.
--   human                   — a person made the link.
--
-- There is deliberately NO `index_alignment` value. That is what
-- `vendorAssuranceExportData.ts` used to do — attach `responses[i]` to
-- `exceptions[i]` by array position when the ref did not match, silently, with
-- nothing recorded — and this package deletes it rather than naming it.
--
-- ── The effect vocabulary is TWO values, and that is not an oversight ──────
--
-- Owner ruling: propose the SMALLEST exception-effect vocabulary the
-- investigation supports, and do not invent a severity taxonomy for
-- convenience. Two effects are witnessed:
--
--   control_deficiency — "3 of 25 access requests lacked documented manager
--                        approval"; "the control did not operate effectively".
--   scope_limitation   — "Scope limitation applied. Sufficient appropriate
--                        evidence was not available"; "records prior to
--                        1 June 2025 were not available for inspection".
--
-- These are different KINDS of statement, not different magnitudes of one. A
-- scope limitation says assurance was not OBTAINABLE; it does not say the
-- control failed, and representing it as a deficiency because it limits
-- assurance is the specific error the owner ruled against.
--
-- SEVERITY IS NOT ENCODED, AND NOT FROM THE WORDS. `source_term` preserves
-- whether the auditor wrote "exception" or "deviation", and nothing may read
-- that split as a ranking. `governed_effect` is set by a human, never derived
-- from terminology, and NULL means nobody has interpreted it yet. NULL is not
-- "fine".
--
-- Rollback: docs/release/ROLLBACK-20261077.sql
-- Additive, idempotent, re-runnable.

-- ── Exception identity ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendor_assurance_exceptions (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id              UUID        NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,
  extraction_id            UUID        NOT NULL REFERENCES vendor_assurance_extractions(id) ON DELETE CASCADE,

  -- The REPORT'S OWN LABEL, when it has one ("Exception 1"). NULL when the
  -- report labels nothing, which is the common case.
  exception_ref            TEXT        NULL,

  -- Position in the extracted array. PROVENANCE ONLY — never an identity, and
  -- nothing may key a governance decision on it, because an override rewrites
  -- the whole array and would re-point the decision at a different exception.
  -- It exists so an extracted exception with no label can still be traced back
  -- to the exact array element it came from.
  source_ordinal           INTEGER     NOT NULL,

  description              TEXT        NOT NULL,
  auditor_assessment       TEXT        NULL,

  -- SOURCE TERMINOLOGY, carrying no severity.
  source_term              TEXT        NULL,

  -- LAYER 3, the governed answer. NULL = no human has interpreted this yet.
  -- NULL IS NOT "no effect" and must never be read as one.
  governed_effect          TEXT        NULL,
  effect_reviewer_note     TEXT        NULL,
  effect_accepted_by_user_id UUID      NULL REFERENCES users(id) ON DELETE SET NULL,
  effect_accepted_at       TIMESTAMPTZ NULL,
  effect_basis             JSONB       NULL,

  effective_source         TEXT        NOT NULL,
  override_id              UUID        NULL REFERENCES vendor_assurance_field_overrides(id) ON DELETE RESTRICT,

  materialized_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at            TIMESTAMPTZ NULL,

  CONSTRAINT vendor_assurance_exceptions_effect_vocabulary_check
    CHECK (governed_effect IS NULL
           OR governed_effect IN ('control_deficiency', 'scope_limitation')),

  CONSTRAINT vendor_assurance_exceptions_source_term_check
    CHECK (source_term IS NULL OR source_term IN ('exception', 'deviation')),

  CONSTRAINT vendor_assurance_exceptions_effective_source_check
    CHECK (effective_source IN ('extraction', 'field_override')),

  CONSTRAINT vendor_assurance_exceptions_override_provenance_check
    CHECK (
      (effective_source = 'field_override' AND override_id IS NOT NULL)
      OR
      (effective_source = 'extraction'     AND override_id IS NULL)
    ),

  -- AN INTERPRETATION MUST NAME ITS HUMAN AND ITS MOMENT. An effect with no
  -- actor is an assertion nobody made.
  CONSTRAINT vendor_assurance_exceptions_effect_authority_check
    CHECK (
      (governed_effect IS NULL
        AND effect_accepted_by_user_id IS NULL
        AND effect_accepted_at IS NULL
        AND effect_basis IS NULL)
      OR
      (governed_effect IS NOT NULL
        AND effect_accepted_by_user_id IS NOT NULL
        AND effect_accepted_at IS NOT NULL
        AND effect_basis IS NOT NULL)
    ),

  CONSTRAINT vendor_assurance_exceptions_description_nonempty
    CHECK (length(trim(description)) > 0),

  CONSTRAINT vendor_assurance_exceptions_ordinal_check
    CHECK (source_ordinal >= 0)
);

-- One LIVE exception per (extraction, source ordinal). The ordinal is the only
-- thing guaranteed unique within one extracted array — a label is optional and a
-- description may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_assurance_exceptions_live
  ON vendor_assurance_exceptions (extraction_id, source_ordinal)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_exceptions_document
  ON vendor_assurance_exceptions (organization_id, document_id, materialized_at DESC);

-- ── Exception ↔ tested control linkage (many-to-many) ──────────────────────

CREATE TABLE IF NOT EXISTS vendor_assurance_exception_controls (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exception_id      UUID        NOT NULL REFERENCES vendor_assurance_exceptions(id) ON DELETE CASCADE,

  -- The tested-control identity this exception concerns: the SAME grain as
  -- 20261072's review decisions, 20261073's resolutions and 20261075's
  -- assertions.
  element_key       TEXT        NOT NULL,

  -- WHERE THIS LINK CAME FROM. Never optional, because owner ruling 4 forbids
  -- any heuristic silently associating an exception with a tested control.
  link_source       TEXT        NOT NULL,

  -- The exact source string the link was read out of, verbatim. For a legacy
  -- scalar that packed several identifiers ("CC6.1, CC6.2, CC6.3") this is the
  -- whole string on every link it produced, so the split is inspectable rather
  -- than assumed.
  source_value      TEXT        NOT NULL,

  linked_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- There is deliberately no 'index_alignment'. See the header.
  CONSTRAINT vendor_assurance_exception_controls_link_source_check
    CHECK (link_source IN ('extraction_control_refs', 'legacy_control_id', 'human')),

  -- A human link must name its human; an extracted one must not pretend to have
  -- had one.
  CONSTRAINT vendor_assurance_exception_controls_authority_check
    CHECK (
      (link_source = 'human' AND linked_by_user_id IS NOT NULL)
      OR
      (link_source <> 'human' AND linked_by_user_id IS NULL)
    ),

  CONSTRAINT vendor_assurance_exception_controls_element_key_nonempty
    CHECK (length(trim(element_key)) > 0)
);

-- One link per (exception, tested control). Many controls under one exception
-- is the point; the same pair twice is not.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_assurance_exception_controls_unique
  ON vendor_assurance_exception_controls (exception_id, element_key);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_exception_controls_element
  ON vendor_assurance_exception_controls (organization_id, element_key);

-- ── The human-authority trigger for a governed effect ──────────────────────

CREATE OR REPLACE FUNCTION vendor_assurance_require_human_exception_effect()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Only the transition INTO an interpreted state. An UPDATE that leaves the
  -- row already interpreted — including the ON DELETE SET NULL that nulls the
  -- reviewer when a user is deleted — is not this trigger's business, for the
  -- reason 20261071 recorded.
  IF NEW.governed_effect IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.governed_effect IS DISTINCT FROM NEW.governed_effect)
  THEN
    IF NEW.effect_accepted_by_user_id IS NULL OR NEW.effect_accepted_at IS NULL THEN
      RAISE EXCEPTION
        'governed effect for vendor assurance exception % has no attributed human reviewer', NEW.id
        USING ERRCODE = '23514',
              HINT = 'Interpreting an exception is a governance determination and must name '
                     'the person who made it. An API key alone establishes permission, '
                     'never human authority.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_assurance_require_human_exception_effect
  ON vendor_assurance_exceptions;

CREATE TRIGGER trg_vendor_assurance_require_human_exception_effect
  BEFORE INSERT OR UPDATE ON vendor_assurance_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION vendor_assurance_require_human_exception_effect();

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE vendor_assurance_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_exceptions_tenant_isolation ON vendor_assurance_exceptions;
CREATE POLICY vendor_assurance_exceptions_tenant_isolation
  ON vendor_assurance_exceptions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_assurance_exception_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_exception_controls_tenant_isolation
  ON vendor_assurance_exception_controls;
CREATE POLICY vendor_assurance_exception_controls_tenant_isolation
  ON vendor_assurance_exception_controls
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_exceptions TO app_request;
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_exception_controls TO app_request;
  END IF;
END
$$;

COMMENT ON TABLE vendor_assurance_exceptions IS
  'VA-S4-4C-3 LAYER 3. One extracted exception or deviation from a vendor '
  'assurance report, WITH AN IDENTITY of its own — which the pre-v3 extraction '
  'contract did not give it, which is why a management response''s '
  '`exception_ref` could hold either an exception label or a control id. '
  'governed_effect is set by a NAMED HUMAN and is NULL until then; NULL means '
  'uninterpreted, never "no effect". Independent of Layer 2: an EFFECTIVE '
  'governed effectiveness neither touches nor erases any row here.';

COMMENT ON COLUMN vendor_assurance_exceptions.exception_ref IS
  'The REPORT''S OWN label for this exception (e.g. "Exception 1"), or NULL. '
  'This is what `management_responses[].exception_ref` points at in the '
  'corrected v3 contract — it is an exception label and never a control '
  'identifier.';

COMMENT ON COLUMN vendor_assurance_exceptions.governed_effect IS
  'TWO values, both witnessed in the corpus, carrying NO severity: '
  '''control_deficiency'' (the control failed to operate or to be designed as '
  'intended) and ''scope_limitation'' (assurance was not OBTAINABLE — the '
  'control is NOT thereby deficient). Never derived from whether the auditor '
  'wrote "exception" or "deviation". NULL = not yet interpreted by a human.';

COMMENT ON TABLE vendor_assurance_exception_controls IS
  'VA-S4-4C-3 LAYER 3 linkage. Which tested control(s) an exception concerns, '
  'many-to-many — witnessed in the corpus as one exception spanning CC6.1, '
  'CC6.2 and CC6.3. Every link records link_source and the verbatim '
  'source_value it was read out of, because no heuristic may SILENTLY associate '
  'an exception with a tested control. There is deliberately no '
  '''index_alignment'' link source: attaching by array position is the defect '
  'this package removes, not a provenance value.';
