-- Migration: vendor_relationship_intake
-- Package: Vendor Onboarding 2.0, increment VO-2
--
-- ── ONE factual intake feeds every deterministic engine ─────────────────────
-- The customer answers FACTS about the relationship, once. Nothing here is a
-- classification: no criticality, no risk band, no tier. Those are DERIVED by
-- criticality.ts, inherentRiskV2.ts and assessmentTier.ts and persist on the
-- relationship row (20261086). Asking a customer to choose a classification the
-- platform can derive is the failure Onboarding 2.0 exists to remove.
--
-- Two fact families, kept in one row because they are answered in one sitting:
--
--   CRITICALITY facts (business dependency — owner ruling 1):
--     max_tolerable_disruption, operational_dependency, business_reach,
--     substitutability, process_coupling, concentration
--
--   EXPOSURE facts (inherent risk v2):
--     data_sensitivity, data_volume, access_level, regulatory_exposure,
--     regulatory_breach_notification, ai_involvement, ai_autonomy,
--     hosting_model, fourth_party_exposure
--
-- regulatory_exposure is DECLARED, exactly as the shipped v1 engagement intake
-- declares it. inherentRisk.ts carries a comment saying it is "derived from
-- the org's ACTIVE obligations" via resolveRegulatoryExposure() — that function
-- was never built, and `obligations` has no breach-notification attribute to
-- derive the duty from. Deriving a LEVEL would mean inventing a count->level
-- mapping, a methodology constant nobody has approved. So it is asked, as
-- today, and derivation is recorded as a follow-on needing an owner-ruled
-- mapping. Nothing is manufactured.
--
-- ── Append-only, versioned ──────────────────────────────────────────────────
-- Every submission is a new version. Nothing is updated in place, because a
-- classification names the intake version that produced it
-- (vendor_relationships.classification_intake_id) and that row must be exactly
-- what the engines read. "Current" is the highest version — there is no
-- is_current flag to flip, because flipping it would be an UPDATE the guard
-- forbids.
--
-- Wired to the SHARED `worm_guard_mutation` (20261017), never a private copy:
-- the certified-erasure exception lives in that one function, so a governed
-- tenant erasure still succeeds while every other mutation is refused.
--
-- created_by_user_id is ON DELETE SET NULL, which would be an UPDATE the
-- guard refuses — and it never fires, because users are tombstoned (O-3), not
-- deleted. Same reasoning as engagement_applicability.

CREATE TABLE IF NOT EXISTS vendor_relationship_intake (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- CASCADE with the relationship: intake is meaningless without it, and the
  -- relationship row itself is protected by its engagements (RESTRICT).
  relationship_id           UUID        NOT NULL REFERENCES vendor_relationships(id) ON DELETE CASCADE,
  version                   INTEGER     NOT NULL CHECK (version >= 1),

  -- ── Criticality facts ───────────────────────────────────────────────────
  max_tolerable_disruption  TEXT        NOT NULL
                              CHECK (max_tolerable_disruption IN ('gt_1_month', '1_week_to_1_month', '1_to_7_days', 'lt_24_hours')),
  operational_dependency    TEXT        NOT NULL
                              CHECK (operational_dependency IN ('incidental', 'supporting', 'significant', 'essential')),
  business_reach            TEXT        NOT NULL
                              CHECK (business_reach IN ('single_team', 'single_function', 'multi_function', 'enterprise_wide')),
  substitutability          TEXT        NOT NULL
                              CHECK (substitutability IN ('interchangeable', 'replaceable_weeks', 'replaceable_months', 'no_viable_alternative')),
  process_coupling          TEXT        NOT NULL
                              CHECK (process_coupling IN ('peripheral', 'supports_critical_path', 'in_critical_path', 'embedded_no_manual_fallback')),
  concentration             TEXT        NOT NULL
                              CHECK (concentration IN ('none', 'low', 'moderate', 'single_point_of_failure')),

  -- ── Exposure facts (same closed sets as vendor_engagements / vendors) ───
  data_sensitivity          TEXT        NOT NULL
                              CHECK (data_sensitivity IN ('none', 'internal', 'confidential', 'restricted')),
  data_volume               TEXT        NOT NULL
                              CHECK (data_volume IN ('minimal', 'moderate', 'large', 'mass')),
  access_level              TEXT        NOT NULL
                              CHECK (access_level IN ('none', 'read_only', 'read_write', 'admin', 'network_access')),
  regulatory_exposure       TEXT        NOT NULL
                              CHECK (regulatory_exposure IN ('none', 'low', 'moderate', 'high')),
  -- True when an active obligation in scope carries a breach-notification duty.
  -- Declared, and the trigger for the inherent floor E3.
  regulatory_breach_notification BOOLEAN NOT NULL,
  ai_involvement            TEXT        NOT NULL
                              CHECK (ai_involvement IN ('none', 'embedded', 'core')),
  ai_autonomy               TEXT        NOT NULL
                              CHECK (ai_autonomy IN ('none', 'human_in_the_loop', 'human_on_the_loop', 'autonomous_consequential')),
  hosting_model             TEXT        NOT NULL
                              CHECK (hosting_model IN ('on_prem', 'private_cloud', 'saas', 'multi_tenant_saas')),
  fourth_party_exposure     TEXT        NOT NULL
                              CHECK (fourth_party_exposure IN ('none', 'low', 'moderate', 'high')),

  created_by_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (relationship_id, version),
  -- Autonomy without involvement is a contradiction, not a fact.
  CONSTRAINT vendor_relationship_intake_ai_consistent CHECK (
    ai_involvement <> 'none' OR ai_autonomy = 'none'
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_relationship_intake_current
  ON vendor_relationship_intake (organization_id, relationship_id, version DESC);

COMMENT ON TABLE vendor_relationship_intake IS
  'Vendor Onboarding 2.0: append-only, versioned FACTUAL intake per relationship. '
  'No classifications live here — they are derived and persist on vendor_relationships.';

-- ---------------------------------------------------------------
-- Append-only (shared guard)
-- ---------------------------------------------------------------
DROP TRIGGER IF EXISTS prevent_vendor_relationship_intake_row_mutation ON vendor_relationship_intake;
CREATE TRIGGER prevent_vendor_relationship_intake_row_mutation
  BEFORE UPDATE OR DELETE ON vendor_relationship_intake
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (relationship intake history)');

DROP TRIGGER IF EXISTS prevent_vendor_relationship_intake_truncate ON vendor_relationship_intake;
CREATE TRIGGER prevent_vendor_relationship_intake_truncate
  BEFORE TRUNCATE ON vendor_relationship_intake
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (relationship intake history)');

-- Now that the intake table exists, the provenance pointer on the relationship
-- can be a real FK. RESTRICT: the intake that produced a classification must
-- outlive it (and the guard refuses the delete anyway).
ALTER TABLE vendor_relationships
  ADD CONSTRAINT vendor_relationships_classification_intake_fk
  FOREIGN KEY (classification_intake_id) REFERENCES vendor_relationship_intake(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------
ALTER TABLE vendor_relationship_intake ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_relationship_intake_tenant_isolation ON vendor_relationship_intake;
CREATE POLICY vendor_relationship_intake_tenant_isolation ON vendor_relationship_intake
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- SELECT + INSERT only. There is no UPDATE or DELETE for the request role to
-- have: the table is append-only by trigger, and the grant says so too.
GRANT SELECT, INSERT ON vendor_relationship_intake TO app_request;
