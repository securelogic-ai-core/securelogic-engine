-- Migration: obligation_assessment_workflow
-- Package: obligation-assessment-workflow
-- Depends on: obligation-regulatory-primitives (obligations table),
--             platform-foundation-findings-actions-posture (findings table)
--
-- Adds the obligation_assessments table.
-- Mutable workflow record: one assessment per evaluation cycle per obligation.
-- Findings are produced at PATCH time on first non_compliant or partially_compliant
-- transition; never at POST time.
--
-- This migration is additive. It does not alter any existing table.

-- ---------------------------------------------------------------
-- obligation_assessments
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS obligation_assessments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  obligation_id     UUID        NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT 'not_started',
  overall_severity  TEXT        NULL,
  summary           TEXT        NULL,
  notes             TEXT        NULL,
  performed_at      DATE        NULL,
  reviewer_id       TEXT        NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT obligation_assessments_status_check CHECK (
    status IN ('not_started', 'in_progress', 'compliant', 'non_compliant', 'partially_compliant')
  ),
  CONSTRAINT obligation_assessments_severity_check CHECK (
    overall_severity IS NULL OR overall_severity IN ('Critical', 'High', 'Moderate', 'Low')
  )
);

-- org-scoped list queries (the primary access pattern)
CREATE INDEX IF NOT EXISTS idx_obligation_assessments_org_created
  ON obligation_assessments (organization_id, created_at DESC, id DESC);

-- filter by obligation_id within org
CREATE INDEX IF NOT EXISTS idx_obligation_assessments_org_obligation
  ON obligation_assessments (organization_id, obligation_id);

-- filter by status within org
CREATE INDEX IF NOT EXISTS idx_obligation_assessments_org_status
  ON obligation_assessments (organization_id, status);

-- finding linkage lookup: source_type='obligation_review', source_id=obligation_assessments.id
-- The findings table's existing index on (organization_id, source_type, source_id) covers this.
-- No additional index needed here.

-- ---------------------------------------------------------------
-- Verification query (run after applying):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'obligation_assessments'
--   ORDER BY ordinal_position;
-- ---------------------------------------------------------------
