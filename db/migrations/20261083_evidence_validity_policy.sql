-- =====================================================================
-- 20261083 — Evidence-validity policy (VA-S4 wiring-plan step 3)
-- =====================================================================
--
-- Authority: owner ratification 2026-09-01 of D0, D1, D15 and D16 in
-- docs/design/VA-EVIDENCE-validity-policy-RATIFICATION-MEMO.md.
--
-- Step 2 (20261080) landed the substrate: evidence carries valid_from,
-- valid_until, validity_basis and assurance_class, and every pre-existing row
-- is 'not_established' + 'unclassified'. It deliberately shipped NO duration,
-- and validity_basis deliberately had NO 'policy_default' value, because a
-- value only a ratified policy could produce would imply a policy existed.
--
-- This migration adds that value and the policy that produces it.
--
-- WHAT IS RATIFIED, AND WHAT IS NOT
--
--   D0  assurance_class stays its own orthogonal axis.        RATIFIED — 20261080.
--   D1  SOC 1 / SOC 2: 12 months from report period end,
--       customer range 3..15, Type I on its OWN rule.         RATIFIED — seeded below.
--   D15 Customers tighten freely, loosen only to the platform
--       ceiling, never past the artifact's own dates, and
--       every change is VERSIONED.                            RATIFIED — tables below.
--   D16 No backfill of the legacy estate; humans establish
--       class and validity at creation.                       RATIFIED — nothing is backfilled here.
--
--   D2..D14 are NOT ratified. Every other assurance class therefore has NO
--   policy row, which means NO default duration, which means an artifact of
--   that class stays 'not_established' and counts for nothing. That is the
--   fail-closed default, not a decision — seeding a speculative duration for an
--   unratified class would be precisely the "catch-all TTL wearing a different
--   name" the memo warns about.
--
-- THE ONE VALUE D1 DID NOT PIN DOWN
--
--   D1 ratified that a Type I "must not inherit the Type II rule" but named no
--   number for it. This migration does NOT invent one. soc2_type1 is seeded
--   with default_duration_months = NULL, i.e. no operating-effectiveness
--   validity is established by a Type I at all. That is fail-closed, it is
--   consistent with the column comment 20261080 already carries ("a Type I
--   attests design at a point in time and can never establish that a control
--   OPERATED"), and it is independently redundant with 4C-4's Type I veto,
--   which fires on its own. If the owner later ratifies a Type I duration it
--   arrives as a new policy VERSION, which is exactly what the versioning below
--   exists for.
--
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. validity_basis gains 'policy_default'
-- ---------------------------------------------------------------
--
-- The fourth basis: a window this platform COMPUTED from a ratified policy,
-- as distinct from one a human read off the artifact ('artifact_dates').
-- Keeping them separate is what lets a determination say WHY a window is what
-- it is, and lets a policy change be reasoned about without being mistaken for
-- someone having re-read the document.

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_validity_basis_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_validity_basis_check CHECK (
    validity_basis IN ('not_established', 'artifact_dates', 'perpetual', 'policy_default')
  );

-- A computed window must HAVE an end. Same arm shape as artifact_dates:
-- the difference between the two is provenance, not shape.
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_validity_shape_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_validity_shape_check CHECK (
    (validity_basis = 'not_established'
       AND valid_from IS NULL AND valid_until IS NULL)
    OR
    (validity_basis = 'artifact_dates'  AND valid_until IS NOT NULL)
    OR
    (validity_basis = 'perpetual'       AND valid_until IS NULL)
    OR
    (validity_basis = 'policy_default'  AND valid_until IS NOT NULL)
  );

COMMENT ON COLUMN evidence.validity_basis IS
  'WHY this row''s window is what it is. not_established = unknown, the '
  'fail-closed default every pre-existing row carries; artifact_dates = a human '
  'committed a window the artifact itself states; perpetual = the artifact '
  'asserts no end (a contract until terminated); policy_default = this platform '
  'COMPUTED the window from a ratified evidence_validity_policy row (20261083). '
  'artifact_dates always outranks policy_default: a policy may never extend a '
  'window past what the artifact itself asserts.';

-- ---------------------------------------------------------------
-- 2. evidence_validity_policy — the platform layer, VERSIONED
-- ---------------------------------------------------------------
--
-- Global governed reference content, like the canonical crosswalk: NOT
-- org-scoped and NOT customer-writable. Append-only versions rather than
-- in-place edits, so a determination made in March can be replayed against the
-- policy that was in force in March — D15's reproducibility requirement applies
-- to the platform layer as much as to the customer layer.

CREATE TABLE IF NOT EXISTS evidence_validity_policy (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  assurance_class          TEXT NOT NULL,
  version                  INTEGER NOT NULL CHECK (version >= 1),

  -- NULL = no ratified default for this class. The class then establishes NO
  -- validity, which is the fail-closed outcome, never an implicit forever.
  default_duration_months  INTEGER NULL CHECK (default_duration_months IS NULL OR default_duration_months >= 1),

  -- The ceiling a customer may LOOSEN to (D15). NULL when there is no default.
  max_duration_months      INTEGER NULL CHECK (max_duration_months IS NULL OR max_duration_months >= 1),

  -- The platform's own sanity floor for its DEFAULT. It is deliberately NOT a
  -- customer constraint: D15 ratified that customers may tighten FREELY.
  min_duration_months      INTEGER NULL CHECK (min_duration_months IS NULL OR min_duration_months >= 1),

  -- What the window is measured FROM. 'none' = this class establishes no
  -- policy-derived window at all.
  anchor                   TEXT NOT NULL CHECK (
                             anchor IN ('report_period_end', 'collected_at', 'artifact_term', 'none')
                           ),

  ratification_ref         TEXT NOT NULL,   -- e.g. 'D1'
  ratified_on              DATE NOT NULL,
  notes                    TEXT NOT NULL,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at            TIMESTAMPTZ NULL,

  CONSTRAINT evidence_validity_policy_class_check CHECK (
    assurance_class IN (
      'unclassified','soc1','soc2_type1','soc2_type2','iso_certification',
      'pen_test','vulnerability_scan','policy_document','bcp_dr_test',
      'technical_configuration','vendor_attestation','privacy_agreement',
      'subprocessor_list','ai_evaluation','contract','other_assurance_report'
    )
  ),

  -- A duration and its guardrails travel together or not at all.
  CONSTRAINT evidence_validity_policy_bounds_shape_check CHECK (
    (default_duration_months IS NULL AND max_duration_months IS NULL AND min_duration_months IS NULL AND anchor = 'none')
    OR
    (default_duration_months IS NOT NULL AND max_duration_months IS NOT NULL AND min_duration_months IS NOT NULL AND anchor <> 'none')
  ),

  CONSTRAINT evidence_validity_policy_bounds_order_check CHECK (
    default_duration_months IS NULL
    OR (min_duration_months <= default_duration_months
        AND default_duration_months <= max_duration_months)
  ),

  -- 'unclassified' can never carry a policy. An artifact nobody classified
  -- must not inherit a duration — the whole point of the fail-closed default.
  CONSTRAINT evidence_validity_policy_no_unclassified_check CHECK (
    assurance_class <> 'unclassified'
  ),

  CONSTRAINT evidence_validity_policy_version_unique UNIQUE (assurance_class, version)
);

-- Exactly one LIVE version per class.
CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_validity_policy_live
  ON evidence_validity_policy (assurance_class)
  WHERE superseded_at IS NULL;

COMMENT ON TABLE evidence_validity_policy IS
  'The ratified platform evidence-validity policy (VA-S4 step 3). Global '
  'governed content, not org-scoped and not customer-writable — customers '
  'express their own position in organization_evidence_validity_settings. '
  'Append-only versions: superseding never edits, so a past determination '
  'remains replayable against the policy in force at the time. A class with no '
  'row establishes NO validity; absence is the fail-closed default, never a '
  'catch-all TTL.';

-- ---------------------------------------------------------------
-- 3. The ratified content — D1 ONLY
-- ---------------------------------------------------------------

INSERT INTO evidence_validity_policy
  (assurance_class, version, default_duration_months, max_duration_months,
   min_duration_months, anchor, ratification_ref, ratified_on, notes)
VALUES
  ('soc2_type2', 1, 12, 15, 3, 'report_period_end', 'D1', DATE '2026-09-01',
   'Twelve months from the end of the period the report covers. Matches the '
   'annual cycle these reports are produced on, so a report stays current until '
   'its successor should exist. Customers may tighten below 12 without limit and '
   'may loosen no further than 15.'),

  ('soc1', 1, 12, 15, 3, 'report_period_end', 'D1', DATE '2026-09-01',
   'Same rule as soc2_type2 under D1, which ratified SOC 1 and SOC 2 together.'),

  ('soc2_type1', 1, NULL, NULL, NULL, 'none', 'D1', DATE '2026-09-01',
   'NO policy-derived validity. D1 ratified that a Type I must not inherit the '
   'Type II rule but named no duration for it, and this migration does not '
   'invent one. A Type I attests DESIGN at a point in time and can never '
   'establish that a control operated, so establishing no operating-effectiveness '
   'window is the honest representation as well as the fail-closed one. A '
   'ratified Type I duration would arrive as version 2.')
ON CONFLICT (assurance_class, version) DO NOTHING;

-- ---------------------------------------------------------------
-- 4. organization_evidence_validity_settings — the customer layer
-- ---------------------------------------------------------------
--
-- D15: tighten freely, loosen only to the platform ceiling, never past the
-- artifact's own dates (that last clause is a READ-time rule — a policy window
-- can only ever narrow what artifact_dates already asserts — and is enforced in
-- the contract, not here, because this table does not see artifacts).
--
-- Append-and-supersede, never edit: the version chain IS the audit trail.

CREATE TABLE IF NOT EXISTS organization_evidence_validity_settings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  assurance_class    TEXT NOT NULL,
  duration_months    INTEGER NOT NULL CHECK (duration_months >= 1),
  version            INTEGER NOT NULL CHECK (version >= 1),

  set_by_user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reason             TEXT NOT NULL CHECK (length(btrim(reason)) > 0),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at      TIMESTAMPTZ NULL,

  CONSTRAINT org_evidence_validity_class_check CHECK (
    assurance_class IN (
      'soc1','soc2_type1','soc2_type2','iso_certification',
      'pen_test','vulnerability_scan','policy_document','bcp_dr_test',
      'technical_configuration','vendor_attestation','privacy_agreement',
      'subprocessor_list','ai_evaluation','contract','other_assurance_report'
    )
  ),

  CONSTRAINT org_evidence_validity_version_unique
    UNIQUE (organization_id, assurance_class, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_evidence_validity_live
  ON organization_evidence_validity_settings (organization_id, assurance_class)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_evidence_validity_org
  ON organization_evidence_validity_settings (organization_id, assurance_class);

COMMENT ON TABLE organization_evidence_validity_settings IS
  'A customer''s own validity position per assurance class (D15, ratified '
  '2026-09-01). Tighten freely; loosen only to the live platform ceiling, which '
  'a trigger enforces. Append-and-supersede: rows are never edited, so a '
  'determination made under an earlier setting stays reconstructible. A class '
  'with no live platform policy cannot be configured at all — there is no '
  'ceiling to bound it and no default to depart from.';

-- ---------------------------------------------------------------
-- 5. The guardrail, as a trigger (it needs a lookup, so a CHECK cannot do it)
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION org_evidence_validity_guardrail()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_max INTEGER;
  v_found BOOLEAN;
BEGIN
  SELECT p.max_duration_months, TRUE
    INTO v_max, v_found
    FROM evidence_validity_policy p
   WHERE p.assurance_class = NEW.assurance_class
     AND p.superseded_at IS NULL;

  IF NOT COALESCE(v_found, FALSE) THEN
    RAISE EXCEPTION
      'no live evidence_validity_policy for assurance_class %: a class with no ratified policy cannot be configured',
      NEW.assurance_class
      USING ERRCODE = '23514';
  END IF;

  IF v_max IS NULL THEN
    RAISE EXCEPTION
      'assurance_class % has a policy but NO ratified duration, so there is no ceiling to configure against',
      NEW.assurance_class
      USING ERRCODE = '23514';
  END IF;

  -- D15: loosening is bounded by the platform ceiling. Tightening is not
  -- bounded at all — a stricter customer never needs our permission.
  IF NEW.duration_months > v_max THEN
    RAISE EXCEPTION
      'duration_months % exceeds the platform ceiling % for assurance_class %',
      NEW.duration_months, v_max, NEW.assurance_class
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE INSERT OR UPDATE only. A trigger whose definition mentions DELETE or
-- TRUNCATE must resolve to the shared worm_guard_mutation, and this is not a
-- WORM table — see wormGuardConsolidation.test.ts.
CREATE TRIGGER trg_org_evidence_validity_guardrail
  BEFORE INSERT OR UPDATE ON organization_evidence_validity_settings
  FOR EACH ROW
  EXECUTE FUNCTION org_evidence_validity_guardrail();

-- Identity is frozen once written: a setting may only be SUPERSEDED, never
-- repointed, or a past determination's basis silently changes underneath it.
CREATE OR REPLACE FUNCTION org_evidence_validity_freeze()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.assurance_class IS DISTINCT FROM OLD.assurance_class
     OR NEW.duration_months IS DISTINCT FROM OLD.duration_months
     OR NEW.version         IS DISTINCT FROM OLD.version
     OR NEW.reason          IS DISTINCT FROM OLD.reason
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'organization_evidence_validity_settings is append-and-supersede: only superseded_at may change'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_org_evidence_validity_freeze
  BEFORE UPDATE ON organization_evidence_validity_settings
  FOR EACH ROW
  EXECUTE FUNCTION org_evidence_validity_freeze();

-- ---------------------------------------------------------------
-- 6. Tenant isolation
-- ---------------------------------------------------------------

ALTER TABLE organization_evidence_validity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_evidence_validity_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_evidence_validity_tenant_isolation
  ON organization_evidence_validity_settings;
CREATE POLICY org_evidence_validity_tenant_isolation
  ON organization_evidence_validity_settings
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    -- Platform policy is READ-ONLY to the application. It changes by migration.
    GRANT SELECT ON evidence_validity_policy TO app_request;

    -- Customer layer: append and supersede. No DELETE grant, and UPDATE is
    -- limited to the one column supersession needs.
    GRANT SELECT, INSERT ON organization_evidence_validity_settings TO app_request;
    GRANT UPDATE (superseded_at) ON organization_evidence_validity_settings TO app_request;
  END IF;
END $$;

COMMIT;
