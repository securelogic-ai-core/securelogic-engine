-- 20261079 — VA-S4-4C-4. The governed sufficiency determination.
--
-- The last hop of Ruling 5's chain before step 5: for one candidate
-- (org requirement x tested control x document), does this assurance actually
-- support the objective the requirement represents?
--
-- Ruling 6: a mapping is a CANDIDATE, never a conclusion. One tested control
-- resolving to eight crosswalk rows must not become eight covered requirements.
-- So the determination is per candidate, and it is a human act.
--
-- ── FAIL-CLOSED IS STRUCTURAL, NOT POLICY ──────────────────────────────────
--
-- OWNER RULING 2026-08-31: SUFFICIENT hard-refuses if ANY evaluated veto is
-- FIRED **or** NOT_EVALUABLE. No human override of epistemic insufficiency.
--
-- That ruling is enforced HERE, by CHECK, and not only in the route. A route
-- can be bypassed by a future writer; a CHECK cannot. The basis carries the
-- twelve-veto evaluation by value, and a SUFFICIENT row is refused unless that
-- basis records zero fired and zero not-evaluable. There is deliberately NO
-- override column: nothing in this schema can express "sufficient anyway".
--
-- Human RISK ACCEPTANCE is a different layer and must never rewrite an
-- INDETERMINATE assurance basis into SUFFICIENT. Accepting a risk says an
-- organisation will tolerate a gap; it does not say the gap was closed. Nothing
-- in the finding_risk_acceptances path may write this table, and an adversarial
-- test asserts that no such writer exists.
--
-- ── WHAT THIS TABLE DOES NOT DO ────────────────────────────────────────────
--
-- It establishes NO requirement coverage. Nothing reads it for S4, for
-- questionnaire reduction, or for residual risk: step 5 still depends on
-- ADR-0012 (step 2) and the evidence-validity policy (step 3). Every basis
-- restates `establishes_requirement_coverage: false` as recorded data.
--
-- CONSEQUENCE, STATED SO IT IS NOT MISREAD AS A DEFECT: with the contradictory-
-- evidence veto permanently NOT_EVALUABLE until ADR-0012 exists, and the report-
-- period veto NOT_EVALUABLE until a validity policy is ratified, this table
-- accepts ZERO `SUFFICIENT` rows on the day it ships. Every determination lands
-- INDETERMINATE. That is the truthful state of the platform, ruled acceptable
-- and expected by the owner, and it is now machine-readable per candidate
-- instead of a paragraph in a design document.
--
-- Reversible: docs/release/ROLLBACK-20261079.sql.

CREATE TABLE IF NOT EXISTS vendor_requirement_sufficiency_determinations (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id                   UUID        NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,
  extraction_id                 UUID        NOT NULL REFERENCES vendor_assurance_extractions(id) ON DELETE CASCADE,

  -- The candidate this judges. 20261073's resolution row already pins the
  -- tested control and the canonical control it resolved to.
  resolution_id                 UUID        NOT NULL REFERENCES vendor_tested_control_resolutions(id) ON DELETE CASCADE,
  element_key                   TEXT        NOT NULL,
  canonical_control_id          UUID        NOT NULL REFERENCES canonical_controls(id) ON DELETE RESTRICT,

  -- The ORGANISATION-side requirement being judged, reached by inverting the
  -- governed crosswalk. Held by value so the verdict survives a re-curation.
  requirement_framework_key     TEXT        NOT NULL,
  requirement_framework_version TEXT        NOT NULL,
  requirement_reference         TEXT        NOT NULL,

  determination                 TEXT        NOT NULL,
  indeterminate_reason          TEXT        NULL,

  -- 20261071 / 20261076 pattern: nullable with ON DELETE SET NULL, and an
  -- INSERT-scoped trigger. A steady-state NOT NULL would make deleting a user
  -- who had ever made a determination fail.
  determined_by_user_id         UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  determined_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewer_note                 TEXT        NULL,

  basis                         JSONB       NOT NULL,
  evaluator_version             TEXT        NOT NULL,

  superseded_at                 TIMESTAMPTZ NULL,

  CONSTRAINT vendor_requirement_sufficiency_determination_vocabulary_check
    CHECK (determination IN ('SUFFICIENT', 'INSUFFICIENT', 'INDETERMINATE')),

  CONSTRAINT vendor_requirement_sufficiency_reason_vocabulary_check
    CHECK (indeterminate_reason IS NULL
           OR indeterminate_reason IN ('veto_not_evaluable', 'veto_fired',
                                       'scope_unclear', 'conflicting_evidence')),

  CONSTRAINT vendor_requirement_sufficiency_reason_shape_check
    CHECK (
      (determination = 'INDETERMINATE' AND indeterminate_reason IS NOT NULL)
      OR
      (determination <> 'INDETERMINATE' AND indeterminate_reason IS NULL)
    ),

  -- THE RULING, AS A CONSTRAINT. A SUFFICIENT determination is refused unless
  -- its own snapshotted basis records that every veto passed.
  --
  -- This reads the VETO STATES THEMSELVES, not the summary counts beside them,
  -- for two reasons. First, a self-reported count is a number the writer chose;
  -- the states are the evaluation. Second, and worse: `basis #>> '{counts,fired}'`
  -- returns NULL when the key is absent, `NULL = 0` is NULL, and a CHECK that
  -- evaluates to NULL PASSES. A basis with no counts key would therefore have
  -- been accepted as SUFFICIENT. Verified against Postgres 16 before this was
  -- written, not assumed.
  --
  -- jsonb_path_exists returns false (never null) for a missing path, and the
  -- completeness constraint below independently requires the twelve vetoes to
  -- be there, so the pair cannot be dodged from either side.
  CONSTRAINT vendor_requirement_sufficiency_fail_closed_check
    CHECK (
      determination <> 'SUFFICIENT'
      OR NOT jsonb_path_exists(basis, '$.vetoes[*] ? (@.state <> "PASSED")')
    ),

  -- The summary counts are still required to be present and well-formed, because
  -- readers and the acceptance harness use them. They are a convenience, and the
  -- constraint above deliberately does not trust them.
  CONSTRAINT vendor_requirement_sufficiency_counts_present_check
    CHECK (
      (basis #>> '{counts,passed}') IS NOT NULL
      AND (basis #>> '{counts,fired}') IS NOT NULL
      AND (basis #>> '{counts,not_evaluable}') IS NOT NULL
    ),

  -- All TWELVE vetoes must be present by value, so a determination can never be
  -- recorded against a partial evaluation.
  CONSTRAINT vendor_requirement_sufficiency_basis_completeness_check
    CHECK (jsonb_typeof(basis -> 'vetoes') = 'array'
           AND jsonb_array_length(basis -> 'vetoes') = 12),

  -- This table never asserts coverage, and says so in every row.
  CONSTRAINT vendor_requirement_sufficiency_no_coverage_claim_check
    CHECK ((basis ->> 'establishes_requirement_coverage') = 'false'),

  CONSTRAINT vendor_requirement_sufficiency_element_key_nonempty
    CHECK (length(trim(element_key)) > 0),

  CONSTRAINT vendor_requirement_sufficiency_requirement_reference_nonempty
    CHECK (length(trim(requirement_reference)) > 0),

  CONSTRAINT vendor_requirement_sufficiency_evaluator_version_nonempty
    CHECK (length(trim(evaluator_version)) > 0)
);

-- One live determination per candidate. Supersession appends; it never updates
-- a live row in place, so the history of what was judged when stays readable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_requirement_sufficiency_live
  ON vendor_requirement_sufficiency_determinations
     (resolution_id, requirement_framework_key, requirement_framework_version, requirement_reference)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_requirement_sufficiency_document
  ON vendor_requirement_sufficiency_determinations
     (organization_id, document_id, determined_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_requirement_sufficiency_control
  ON vendor_requirement_sufficiency_determinations (canonical_control_id)
  WHERE superseded_at IS NULL;

CREATE OR REPLACE FUNCTION vendor_assurance_require_human_determiner()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.determined_by_user_id IS NULL THEN
    RAISE EXCEPTION
      'sufficiency determination for % / % has no attributed human reviewer',
      NEW.element_key, NEW.requirement_reference
      USING ERRCODE = '23514',
            HINT = 'Requirement sufficiency is a human determination and must name the '
                   'person who made it. Decide as an authenticated user; an API key alone '
                   'establishes permission, never human authority.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION vendor_assurance_require_human_determiner() IS
  'VA-S4-4C-4. Makes an unattributed sufficiency determination impossible at the '
  'database layer. INSERT-only, following 20261071 and 20261076.';

DROP TRIGGER IF EXISTS trg_vendor_assurance_require_human_determiner
  ON vendor_requirement_sufficiency_determinations;
CREATE TRIGGER trg_vendor_assurance_require_human_determiner
  BEFORE INSERT ON vendor_requirement_sufficiency_determinations
  FOR EACH ROW EXECUTE FUNCTION vendor_assurance_require_human_determiner();

ALTER TABLE vendor_requirement_sufficiency_determinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_requirement_sufficiency_tenant_isolation
  ON vendor_requirement_sufficiency_determinations;
CREATE POLICY vendor_requirement_sufficiency_tenant_isolation
  ON vendor_requirement_sufficiency_determinations
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON vendor_requirement_sufficiency_determinations TO app_request;
  END IF;
END
$$;

COMMENT ON TABLE vendor_requirement_sufficiency_determinations IS
  'VA-S4-4C-4. Whether a vendor assurance candidate actually SUPPORTS the '
  'objective an organisation requirement represents — the governed sufficiency '
  'determination named by Ruling 5, made by an attributed human against the '
  'twelve coverage vetoes. Establishes NO requirement coverage on its own: S4 '
  'wiring is step 5 and still depends on ADR-0012. Absence of a row is absence '
  'of sufficiency; nothing materialises, defaults or seeds this table.';

COMMENT ON COLUMN vendor_requirement_sufficiency_determinations.basis IS
  'The twelve-veto evaluation snapshotted BY VALUE at the moment of decision '
  '(veto 12, historical decision basis), so the verdict stays reconstructable '
  'after the crosswalk, the corpus and the evaluator have all moved. The '
  'fail-closed CHECK reads counts.fired and counts.not_evaluable from here.';
