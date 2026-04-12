-- Migration: control_assessment_workflow
-- Package: control-assessment-workflow
-- Depends on: control-framework-primitives (controls table)
--
-- Introduces control_assessments as a mutable, org-scoped workflow record
-- that tracks the lifecycle of a control test/assessment.
--
-- FINDING CREATION RULE (enforced by application, not FK):
--   findings.source_type = 'control_test'
--   findings.source_id   = control_assessments.id
--   findings.domain      = 'General'
--
-- A finding is created ONLY on the first PATCH transition into:
--   status = 'failed' OR status = 'remediation_required'
--
-- A 'passed' assessment never creates a finding.
-- No finding is created at POST (creation time).
-- "First" is enforced by checking whether a finding with source_type='control_test'
-- and source_id=control_assessments.id already exists before creating a new one.
--
-- STATUS VALUES (exactly):
--   not_started | in_progress | passed | failed | remediation_required
--
-- overall_severity is nullable at creation time.
-- It is required when transitioning to 'failed' or 'remediation_required'.
--
-- IF NOT EXISTS justification:
--   Migrations are one-directional with no rollback mechanism.
--   Guard allows safe re-execution during development if a migration is partially applied.
--   In production (single-pass), each migration runs once — the guard is inert.

CREATE TABLE IF NOT EXISTS control_assessments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  control_id       UUID        NOT NULL REFERENCES controls(id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'not_started'
                   CHECK (status IN ('not_started', 'in_progress', 'passed', 'failed', 'remediation_required')),
  overall_severity TEXT
                   CHECK (overall_severity IS NULL OR overall_severity IN ('Critical', 'High', 'Moderate', 'Low')),
  summary          TEXT,
  notes            TEXT,
  performed_at     DATE,
  reviewer_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List assessments for an org ordered by recency
CREATE INDEX IF NOT EXISTS idx_control_assessments_org_created
  ON control_assessments (organization_id, created_at DESC);

-- List assessments for a specific control (within org)
CREATE INDEX IF NOT EXISTS idx_control_assessments_control_created
  ON control_assessments (control_id, created_at DESC);

-- Composite for org + control scoped queries
CREATE INDEX IF NOT EXISTS idx_control_assessments_org_control
  ON control_assessments (organization_id, control_id);
