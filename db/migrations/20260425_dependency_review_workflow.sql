-- Migration: dependency_review_workflow
-- Package: dependency-review-workflow
-- Depends on: dependency-primitives (dependencies table),
--             platform-foundation-findings-actions-posture (findings table)
--
-- Adds the dependency_assessments table.
-- Mutable workflow record: one or more assessment cycles per dependency.
-- Findings are produced at PATCH time on first 'flagged' or 'needs_remediation'
-- transition; never at POST time.
--
-- FINDING CREATION RULE (enforced by application, not FK):
--   findings.source_type = 'dependency_review'
--   findings.source_id   = dependency_assessments.id
--   findings.domain      = dependency.name (as context label)
--
-- STATUS VALUES (exactly):
--   not_started | in_progress | acceptable | flagged | needs_remediation
--
-- Finding-triggering statuses: flagged, needs_remediation
-- overall_severity is required when transitioning to a finding-triggering status.
--
-- This migration is additive. It does not alter any existing table beyond the
-- findings source_type CHECK constraint expansion (additive only).

-- ---------------------------------------------------------------
-- dependency_assessments
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dependency_assessments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dependency_id    UUID        NOT NULL REFERENCES dependencies(id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'not_started',
  overall_severity TEXT        NULL,
  summary          TEXT        NULL,
  notes            TEXT        NULL,
  performed_at     DATE        NULL,
  reviewer_id      TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dependency_assessments_status_check CHECK (
    status IN ('not_started', 'in_progress', 'acceptable', 'flagged', 'needs_remediation')
  ),
  CONSTRAINT dependency_assessments_severity_check CHECK (
    overall_severity IS NULL OR overall_severity IN ('Critical', 'High', 'Moderate', 'Low')
  )
);

-- org-scoped list queries (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_dependency_assessments_org_created
  ON dependency_assessments (organization_id, created_at DESC, id DESC);

-- filter by dependency_id within org
CREATE INDEX IF NOT EXISTS idx_dependency_assessments_org_dependency
  ON dependency_assessments (organization_id, dependency_id);

-- filter by status within org
CREATE INDEX IF NOT EXISTS idx_dependency_assessments_org_status
  ON dependency_assessments (organization_id, status);

-- ---------------------------------------------------------------
-- Expand findings.source_type CHECK to include 'dependency_review'
-- ---------------------------------------------------------------

ALTER TABLE findings
  DROP CONSTRAINT IF EXISTS findings_source_type_check;

ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
    CHECK (source_type IN (
      'assessment',
      'control_test',
      'vendor_review',
      'ai_review',
      'obligation_review',
      'dependency_review',
      'signal',
      'manual',
      'risk'
    ));
