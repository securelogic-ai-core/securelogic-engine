-- Migration: ai_governance_review_workflow
-- Package: ai-governance-review-workflow
-- Depends on: ai-system-governance-primitives (ai_systems table),
--             platform-foundation-findings-actions-posture (findings table),
--             evidence-linkage-workflow (evidence table + source_type constraint)
--
-- Adds the ai_governance_assessments table.
-- An AI governance assessment is a mutable, org-scoped workflow record that
-- tracks an ongoing or periodic governance review of an AI system. It is
-- distinct from governance_reviews (point-in-time, immutable, always creates
-- a finding at POST using source_type='ai_review').
--
-- FINDING CREATION RULE (enforced by application, not FK):
--   A finding is created ONLY on the FIRST PATCH transition into:
--     status = 'non_compliant' OR status = 'partially_compliant'
--   "First" is enforced by checking whether a finding with:
--     source_type = 'ai_governance_review' AND source_id = ai_governance_assessments.id
--   already exists before creating a new one.
--
--   A 'compliant' assessment never creates a finding.
--   No finding is created at POST.
--
--   Findings produced by this package use:
--     source_type = 'ai_governance_review'
--     source_id   = ai_governance_assessments.id  (NOT ai_system_id)
--     domain      = 'AI Governance'
--
-- STATUS VALUES (exactly):
--   not_started | in_progress | compliant | non_compliant | partially_compliant
--
-- Finding-triggering statuses: non_compliant, partially_compliant
-- overall_severity is required when transitioning to a finding-triggering status.
--
-- This migration is additive. It does not alter any existing table beyond
-- the findings and evidence source_type CHECK constraint expansions.

-- ---------------------------------------------------------------
-- ai_governance_assessments
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_governance_assessments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id     UUID        NOT NULL REFERENCES ai_systems(id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'not_started',
  overall_severity TEXT        NULL,
  summary          TEXT        NULL,
  notes            TEXT        NULL,
  performed_at     DATE        NULL,
  reviewer_id      TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_governance_assessments_status_check CHECK (
    status IN ('not_started', 'in_progress', 'compliant', 'non_compliant', 'partially_compliant')
  ),
  CONSTRAINT ai_governance_assessments_severity_check CHECK (
    overall_severity IS NULL OR overall_severity IN ('Critical', 'High', 'Moderate', 'Low')
  )
);

-- org-scoped list queries (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_ai_governance_assessments_org_created
  ON ai_governance_assessments (organization_id, created_at DESC, id DESC);

-- filter by ai_system_id within org
CREATE INDEX IF NOT EXISTS idx_ai_governance_assessments_org_ai_system
  ON ai_governance_assessments (organization_id, ai_system_id);

-- filter by status within org
CREATE INDEX IF NOT EXISTS idx_ai_governance_assessments_org_status
  ON ai_governance_assessments (organization_id, status);

-- ---------------------------------------------------------------
-- Expand findings.source_type CHECK to include 'ai_governance_review'
-- ---------------------------------------------------------------

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
      'signal',
      'manual',
      'risk'
    ));

-- ---------------------------------------------------------------
-- Expand evidence.source_type CHECK to include 'ai_governance_review'
-- ---------------------------------------------------------------

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_source_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_type_check
    CHECK (source_type IN (
      'control_test',
      'vendor_review',
      'ai_review',
      'ai_governance_review',
      'obligation_review',
      'dependency_review',
      'risk_treatment',
      'finding'
    ));
