-- Migration: engagement_intake_and_effectiveness
--
-- Closes the gap between what `computeVendorInherentRisk` REQUIRES and what the
-- engagement spine can actually store, and gives control effectiveness a home.
--
-- ── The four missing intake dimensions ──────────────────────────────────────
-- The spine (20260919) stored the service-context dimensions — data volume,
-- hosting, AI posture, fourth-party exposure — on the reasoning that they
-- describe the engagement rather than the vendor. Correct as far as it went, but
-- four of the model's nine weighted dimensions were left with nowhere to go:
--
--   data_sensitivity        exists on `vendors`
--   access_level            exists on `vendors`
--   business_criticality    exists on `vendors` as `criticality`
--   regulatory_exposure     exists nowhere
--
-- Reading the first three from `vendors` would have been the smaller change and
-- is wrong for the same reason the spine gave for the others: the same vendor
-- engaged for two services legitimately differs. A payroll processor handling
-- restricted data for HR and public marketing copy for the website is one vendor
-- row and two very different exposures. Vendor master data is the DEFAULT a new
-- engagement is seeded from; it is not the assessed value.
--
-- These stay NULLABLE. The spine's existing rows predate them, and a NOT NULL
-- with a backfill default would manufacture intake answers nobody gave — which
-- is precisely the failure the route's "every field required" validation exists
-- to prevent. An engagement missing them cannot be scored, and that is the
-- correct outcome.
--
-- ── Effectiveness had nowhere to live ───────────────────────────────────────
-- The spine carries inherent and residual but not the middle term. Residual is
-- computed FROM effectiveness, so without persisting it the stored residual
-- could not be explained without recomputing — and recomputation gives today's
-- answers, not the ones that produced the rating.
--
-- ── evidence.reviewed_at ────────────────────────────────────────────────────
-- The assurance ladder's `evidenced` rung means "a human or an analyzer
-- confirmed this document supports the claim". Nothing recorded that. Without
-- it, attached evidence can never rise above `documented` and every reviewed
-- control is scored as though nobody read it.

-- ---------------------------------------------------------------
-- 1. The four missing inherent-risk dimensions
-- ---------------------------------------------------------------

ALTER TABLE vendor_engagements
  ADD COLUMN IF NOT EXISTS data_sensitivity     TEXT NULL,
  ADD COLUMN IF NOT EXISTS access_level         TEXT NULL,
  ADD COLUMN IF NOT EXISTS business_criticality TEXT NULL,
  ADD COLUMN IF NOT EXISTS regulatory_exposure  TEXT NULL,
  ADD COLUMN IF NOT EXISTS regulatory_breach_notification BOOLEAN NULL;

-- Vocabularies mirror src/api/lib/vendorRisk/inherentRisk.ts exactly. A value the
-- module cannot score must not be storable; the alternative is a row that reads
-- fine and throws at compute time.
ALTER TABLE vendor_engagements
  DROP CONSTRAINT IF EXISTS vendor_engagements_data_sensitivity_check;
ALTER TABLE vendor_engagements
  ADD CONSTRAINT vendor_engagements_data_sensitivity_check CHECK (
    data_sensitivity IS NULL OR
    data_sensitivity IN ('none', 'internal', 'confidential', 'restricted')
  );

ALTER TABLE vendor_engagements
  DROP CONSTRAINT IF EXISTS vendor_engagements_access_level_check;
ALTER TABLE vendor_engagements
  ADD CONSTRAINT vendor_engagements_access_level_check CHECK (
    access_level IS NULL OR
    access_level IN ('none', 'read_only', 'read_write', 'admin', 'network_access')
  );

ALTER TABLE vendor_engagements
  DROP CONSTRAINT IF EXISTS vendor_engagements_business_criticality_check;
ALTER TABLE vendor_engagements
  ADD CONSTRAINT vendor_engagements_business_criticality_check CHECK (
    business_criticality IS NULL OR
    business_criticality IN ('low', 'medium', 'high', 'critical')
  );

ALTER TABLE vendor_engagements
  DROP CONSTRAINT IF EXISTS vendor_engagements_regulatory_exposure_check;
ALTER TABLE vendor_engagements
  ADD CONSTRAINT vendor_engagements_regulatory_exposure_check CHECK (
    regulatory_exposure IS NULL OR
    regulatory_exposure IN ('none', 'low', 'moderate', 'high')
  );

COMMENT ON COLUMN vendor_engagements.data_sensitivity IS
  'Assessed for THIS engagement, seeded from vendors.data_sensitivity but not '
  'read from it. The same vendor engaged for two services legitimately differs.';

-- ---------------------------------------------------------------
-- 2. Control effectiveness — the middle term
-- ---------------------------------------------------------------

ALTER TABLE vendor_engagements
  ADD COLUMN IF NOT EXISTS effectiveness_score INTEGER NULL,
  ADD COLUMN IF NOT EXISTS effectiveness_basis JSONB   NULL,
  ADD COLUMN IF NOT EXISTS scope_resolved_at   TIMESTAMPTZ NULL;

-- NOTE THE POLARITY. Every other score on this table is 0-100 HIGHER = WORSE.
-- This one is HIGHER = BETTER, because "how good are the controls" genuinely
-- runs the other way from "how bad is the exposure". The CHECK cannot enforce
-- direction, so the comment carries it.
ALTER TABLE vendor_engagements
  DROP CONSTRAINT IF EXISTS vendor_engagements_effectiveness_score_check;
ALTER TABLE vendor_engagements
  ADD CONSTRAINT vendor_engagements_effectiveness_score_check CHECK (
    effectiveness_score IS NULL OR effectiveness_score BETWEEN 0 AND 100
  );

COMMENT ON COLUMN vendor_engagements.effectiveness_score IS
  'Control effectiveness, 0-100 HIGHER = BETTER — the OPPOSITE polarity to '
  'inherent_score and residual_score on this same table. Copying it into either '
  'of those, or comparing them without inverting, produces a confidently wrong '
  'rating. residual = inherent x (1 - effectiveness x 0.7).';

-- ---------------------------------------------------------------
-- 3. Inherent override — rating over score
-- ---------------------------------------------------------------

ALTER TABLE vendor_engagements
  ADD COLUMN IF NOT EXISTS inherent_override_rationale    TEXT NULL,
  ADD COLUMN IF NOT EXISTS inherent_overridden_by_user_id UUID NULL
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inherent_overridden_at         TIMESTAMPTZ NULL;

-- An override is a high-impact governance action and carries its reason or it
-- did not happen. Same shape as the decision-consistency constraint.
ALTER TABLE vendor_engagements
  DROP CONSTRAINT IF EXISTS vendor_engagements_inherent_override_consistency;
ALTER TABLE vendor_engagements
  ADD CONSTRAINT vendor_engagements_inherent_override_consistency CHECK (
    (inherent_overridden_at IS NULL AND inherent_override_rationale IS NULL)
    OR
    (inherent_overridden_at IS NOT NULL
       AND inherent_override_rationale IS NOT NULL
       AND length(trim(inherent_override_rationale)) > 0)
  );

-- ---------------------------------------------------------------
-- 4. evidence.reviewed_at — the `evidenced` rung
-- ---------------------------------------------------------------

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note         TEXT NULL;

COMMENT ON COLUMN evidence.reviewed_at IS
  'Set when a human or an analyzer confirmed this document supports the claim it '
  'is attached to. Promotes the control from `documented` to `evidenced` on the '
  'assurance ladder — the difference between "they attached something" and '
  '"somebody checked", which is most of what a vendor assurance programme is for. '
  'Deliberately NOT set by upload.';

-- The recompute query groups evidence by (engagement, requirement).
CREATE INDEX IF NOT EXISTS idx_evidence_engagement_requirement
  ON evidence (organization_id, engagement_id, requirement_id)
  WHERE engagement_id IS NOT NULL;
