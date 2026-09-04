-- Migration: vendor_relationships
-- Package: Vendor Onboarding 2.0, increment VO-2 (methodology FROZEN 2026-09-03,
--          docs/design/vendor-onboarding-2.0-methodology.md)
--
-- ── The grain that was missing ──────────────────────────────────────────────
-- Canonical hierarchy (owner ruling 4):
--
--   organization -> vendor -> vendor RELATIONSHIP / SERVICE -> engagement
--
-- `vendors` is the counterparty; `vendor_engagements` is one assessment. Nothing
-- in between named WHAT the customer actually buys, so every assessed value had
-- to live on the engagement and be re-asked each time. 20260927 already
-- recorded why the same vendor engaged for two services legitimately differs
-- (a payroll processor handling restricted HR data and public marketing copy is
-- one vendor row and two exposures). This table gives that difference a home.
--
-- A vendor may hold MANY relationships. The UX may auto-create one for the
-- common one-vendor/one-service case; the schema is multi-relationship now.
--
-- ── Derived classification lives HERE, nullable, never manufactured ────────
-- Criticality and inherent risk are PEER engines; the assessment tier is their
-- joint function. All three outputs persist at relationship grain with the
-- same score/band/arithmetic_band/basis/version shape the engagement uses for
-- inherent risk, so a reader can reproduce any rating from its stored basis
-- without the current constants.
--
-- They are NULLABLE and start NULL. Owner ruling 5/M5: no synthetic backfill.
-- A relationship with no sufficient factual intake is `intake_required` — it
-- renders as ignorance, never as a zero and never as a rating. The
-- CHECK constraints below make a half-written classification unrepresentable:
-- either every field of an engine's output is present, or none is.
--
-- ── The manual legacy classification is NOT touched ────────────────────────
-- `vendors.criticality` (the manual dropdown) is preserved with its provenance
-- and is never overwritten by a derived value. Surfaces label it as manually
-- classified. This migration does not read or alter `vendors` at all.
--
-- ── Policy is a FLOOR (M4) ──────────────────────────────────────────────────
-- `policy_minimum_tier` is the customer's request. assessmentTier.ts honours
-- it only when DEEPER than the calculated minimum; it can never lower it.

CREATE TABLE IF NOT EXISTS vendor_relationships (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                 UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- CASCADE: a relationship is meaningless without its vendor, and the vendor
  -- delete path is already governed (vendors.ts refuses while engagements exist).
  vendor_id                       UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  name                            TEXT        NOT NULL,
  service_description             TEXT        NULL,
  status                          TEXT        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'inactive')),
  -- Exactly one primary per vendor (partial unique index below). The UX's
  -- one-service default is the primary; it is a presentation hint, not a
  -- scoring input.
  is_primary                      BOOLEAN     NOT NULL DEFAULT FALSE,

  -- ── Customer policy (raise-only) ────────────────────────────────────────
  policy_minimum_tier             TEXT        NULL
                                    CHECK (policy_minimum_tier IS NULL OR policy_minimum_tier IN
                                      ('tier_1_critical', 'tier_2_high', 'tier_3_moderate', 'tier_4_low')),

  -- ── Derived: CRITICALITY (vendor_criticality_v1) ────────────────────────
  criticality_score               INTEGER     NULL CHECK (criticality_score IS NULL OR criticality_score BETWEEN 0 AND 100),
  criticality_band                TEXT        NULL CHECK (criticality_band IS NULL OR criticality_band IN ('Critical', 'High', 'Moderate', 'Low')),
  criticality_arithmetic_band     TEXT        NULL CHECK (criticality_arithmetic_band IS NULL OR criticality_arithmetic_band IN ('Critical', 'High', 'Moderate', 'Low')),
  criticality_basis               JSONB       NULL,
  criticality_methodology_version TEXT        NULL,

  -- ── Derived: INHERENT RISK (vendor_inherent_v2) ─────────────────────────
  inherent_score                  INTEGER     NULL CHECK (inherent_score IS NULL OR inherent_score BETWEEN 0 AND 100),
  inherent_band                   TEXT        NULL CHECK (inherent_band IS NULL OR inherent_band IN ('Critical', 'High', 'Moderate', 'Low')),
  inherent_arithmetic_band        TEXT        NULL CHECK (inherent_arithmetic_band IS NULL OR inherent_arithmetic_band IN ('Critical', 'High', 'Moderate', 'Low')),
  inherent_basis                  JSONB       NULL,
  inherent_methodology_version    TEXT        NULL,

  -- ── Derived: ASSESSMENT TIER (vendor_assessment_tier_v1) ────────────────
  assessment_tier                 TEXT        NULL
                                    CHECK (assessment_tier IS NULL OR assessment_tier IN
                                      ('tier_1_critical', 'tier_2_high', 'tier_3_moderate', 'tier_4_low')),
  -- SecureLogic's calculated minimum BEFORE policy. Kept so a reader can see
  -- what the methodology said and what policy then did.
  tier_calculated_minimum         TEXT        NULL
                                    CHECK (tier_calculated_minimum IS NULL OR tier_calculated_minimum IN
                                      ('tier_1_critical', 'tier_2_high', 'tier_3_moderate', 'tier_4_low')),
  tier_basis                      JSONB       NULL,
  tier_methodology_version        TEXT        NULL,

  -- Which intake version produced the classification above. Set when the
  -- engines ran; NULL means intake_required.
  classification_intake_id        UUID        NULL,
  classification_computed_at      TIMESTAMPTZ NULL,

  created_by_user_id              UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, vendor_id, name),

  -- A classification is whole or absent. Half a rating is worse than none:
  -- it reads as assessed while being unreproducible.
  CONSTRAINT vendor_relationships_criticality_whole CHECK (
    (criticality_score IS NULL AND criticality_band IS NULL AND criticality_arithmetic_band IS NULL
       AND criticality_basis IS NULL AND criticality_methodology_version IS NULL)
    OR
    (criticality_score IS NOT NULL AND criticality_band IS NOT NULL AND criticality_arithmetic_band IS NOT NULL
       AND criticality_basis IS NOT NULL AND criticality_methodology_version IS NOT NULL)
  ),
  CONSTRAINT vendor_relationships_inherent_whole CHECK (
    (inherent_score IS NULL AND inherent_band IS NULL AND inherent_arithmetic_band IS NULL
       AND inherent_basis IS NULL AND inherent_methodology_version IS NULL)
    OR
    (inherent_score IS NOT NULL AND inherent_band IS NOT NULL AND inherent_arithmetic_band IS NOT NULL
       AND inherent_basis IS NOT NULL AND inherent_methodology_version IS NOT NULL)
  ),
  CONSTRAINT vendor_relationships_tier_whole CHECK (
    (assessment_tier IS NULL AND tier_calculated_minimum IS NULL AND tier_basis IS NULL AND tier_methodology_version IS NULL)
    OR
    (assessment_tier IS NOT NULL AND tier_calculated_minimum IS NOT NULL AND tier_basis IS NOT NULL AND tier_methodology_version IS NOT NULL)
  ),
  -- The tier is a JOINT function: it cannot exist without both peers.
  CONSTRAINT vendor_relationships_tier_requires_peers CHECK (
    assessment_tier IS NULL OR (criticality_band IS NOT NULL AND inherent_band IS NOT NULL)
  ),
  -- A classification names the intake that produced it, and its timestamp.
  CONSTRAINT vendor_relationships_classification_provenance CHECK (
    (classification_intake_id IS NULL AND classification_computed_at IS NULL AND assessment_tier IS NULL)
    OR
    (classification_intake_id IS NOT NULL AND classification_computed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_relationships_org
  ON vendor_relationships (organization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_relationships_vendor
  ON vendor_relationships (organization_id, vendor_id);
-- One primary relationship per vendor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_relationships_primary
  ON vendor_relationships (organization_id, vendor_id)
  WHERE is_primary;
-- The transition surface: relationships awaiting intake.
CREATE INDEX IF NOT EXISTS idx_vendor_relationships_intake_required
  ON vendor_relationships (organization_id)
  WHERE assessment_tier IS NULL;

COMMENT ON TABLE vendor_relationships IS
  'Vendor Onboarding 2.0: the service/relationship grain between a vendor and '
  'its engagements. Derived criticality / inherent risk / tier persist here, '
  'NULL until sufficient factual intake exists (never backfilled).';

-- ---------------------------------------------------------------
-- An engagement belongs to a relationship — NULLABLE, not backfilled
-- ---------------------------------------------------------------
-- Existing engagements predate relationships and must remain readable with
-- none. Same discipline as 20260927: a NOT NULL with a manufactured default
-- would invent a relationship nobody declared. RESTRICT, not CASCADE: an
-- engagement is history and must survive its relationship's lifecycle.

ALTER TABLE vendor_engagements
  ADD COLUMN IF NOT EXISTS relationship_id UUID NULL REFERENCES vendor_relationships(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_vendor_engagements_relationship
  ON vendor_engagements (organization_id, relationship_id)
  WHERE relationship_id IS NOT NULL;

COMMENT ON COLUMN vendor_engagements.relationship_id IS
  'The vendor_relationships row this engagement assesses. NULL for engagements '
  'created before Onboarding 2.0; never backfilled.';

-- ---------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------
ALTER TABLE vendor_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_relationships_tenant_isolation ON vendor_relationships;
CREATE POLICY vendor_relationships_tenant_isolation ON vendor_relationships
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_relationships TO app_request;
