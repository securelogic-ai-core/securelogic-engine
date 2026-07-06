-- Migration: asset_assessments
-- Package: Enterprise Asset Registry — P10 (Track B: generic asset-assessment service)
-- Design authority: docs/architecture/enterprise-asset-registry/P10-ASSESSMENT-SERVICE-MEMO.md
--   (EAR-AD-6: ONE generic table keyed on AssetRef; zero per-type tables ever again).
--
-- The generic assessment workflow record for ANY registry asset. Subject is the
-- polymorphic (asset_type, asset_id) AssetRef (EAR-AD-3) resolved against
-- asset_registry_v at write time — no FK on asset_id (a view cannot be an FK
-- target; precedent: the signal_match_suggestions polymorphic quartet).
--
-- Lifecycle mirrors the obligation_assessments status-machine (the cleanest of
-- the five legacy patterns): not_started → in_progress → one terminal status;
-- 'deficient'/'remediation_required' trigger a finding on FIRST transition in
-- (source_type='asset_assessment'). Vocabulary source of truth:
-- src/api/lib/assessmentSpec.ts (ASSESSMENT_TYPE_SPECS.asset) — the CHECK below
-- must stay in lockstep (asserted by unit test).
--
-- DARK: rows can only be created through /api/asset-assessments, which 404s
-- before auth while SECURELOGIC_ASSET_REGISTRY_ENABLED is off (default
-- everywhere). Additive only; no existing behavior changes.
-- Rollback (manual, forward-only convention): DROP TABLE asset_assessments;
-- re-narrow findings_source_type_check + evidence_source_type_check (both new
-- values are unused while dark).

CREATE TABLE IF NOT EXISTS asset_assessments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_type       TEXT NOT NULL CHECK (asset_type IN (
                     'vendor', 'ai_system', 'application', 'database',
                     'cloud_resource', 'endpoint', 'api', 'identity_system',
                     'business_process', 'generic'
                   )),
  asset_id         UUID NOT NULL,
  status           TEXT NOT NULL CHECK (status IN (
                     'not_started', 'in_progress', 'satisfactory',
                     'deficient', 'remediation_required'
                   )),
  overall_severity TEXT NULL CHECK (
                     overall_severity IN ('Critical', 'High', 'Moderate', 'Low')
                   ),
  summary          TEXT NULL,
  notes            TEXT NULL,
  performed_at     DATE NULL,
  reviewer_uuid    UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_assessments_org_asset
  ON asset_assessments (organization_id, asset_type, asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_assessments_org_status
  ON asset_assessments (organization_id, status);

-- RLS — standard tenant policy (same shape as 20260704_assessments_rls.sql).
-- Writers/readers are asTenant-wrapped from day one (the route is new).
-- NOT FORCE — owner bypasses; INERT until the app_request DATABASE_URL flip.
ALTER TABLE asset_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_assessments_tenant_isolation ON asset_assessments;

CREATE POLICY asset_assessments_tenant_isolation ON asset_assessments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- findings.source_type gains 'asset_assessment' (additive CHECK expansion;
-- precedent: 20260730 added 'applicability_assessment').
ALTER TABLE findings
  DROP CONSTRAINT IF EXISTS findings_source_type_check;

ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
    CHECK (source_type IN (
      'assessment',
      'control_test',
      'vendor_review',
      'vendor_cycle_review',
      'ai_review',
      'ai_governance_review',
      'obligation_review',
      'dependency_review',
      'cyber_signal',
      'signal',
      'manual',
      'risk',
      'applicability_assessment',
      'asset_assessment'
    ));

-- evidence.source_type gains 'asset_assessment' (additive CHECK expansion;
-- precedent: 20260716 added 'risk'). Unused while dark.
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_source_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_type_check
    CHECK (source_type IN (
      'control_test',
      'vendor_review',
      'ai_review',
      'obligation_review',
      'ai_governance_review',
      'dependency_review',
      'risk_treatment',
      'finding',
      'policy_review',
      'risk',
      'asset_assessment'
    ));
