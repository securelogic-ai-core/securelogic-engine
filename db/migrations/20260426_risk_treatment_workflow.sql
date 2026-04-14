-- Migration: risk_treatment_workflow
-- Package: risk-treatment-workflow
-- Depends on: risk-register-primitives (risks table),
--             evidence-primitives (evidence table)
--
-- Adds the risk_treatments table.
-- A risk treatment is a mutable, org-scoped workflow record that tracks
-- how a risk is being addressed. It moves from not_started → in_progress
-- → mitigated | accepted | transferred.
--
-- On PATCH to a terminal status (mitigated, accepted, transferred), the
-- application atomically updates the parent risk's status to match.
--
-- Evidence can be attached to a risk treatment via:
--   evidence.source_type = 'risk_treatment'
--   evidence.source_id   = risk_treatments.id
--
-- This migration also expands the evidence.source_type CHECK to include
-- 'dependency_review' (already supported by application code since
-- dependency-review-workflow was closed) and 'risk_treatment' (this package).
--
-- This migration is additive. It does not alter existing data rows.

-- ---------------------------------------------------------------
-- risk_treatments
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS risk_treatments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_id          UUID        NOT NULL REFERENCES risks(id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'not_started',
  treatment_type   TEXT        NULL,
  owner            TEXT        NULL,
  due_date         DATE        NULL,
  summary          TEXT        NULL,
  notes            TEXT        NULL,
  performed_at     DATE        NULL,
  reviewer_id      TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT risk_treatments_status_check CHECK (
    status IN ('not_started', 'in_progress', 'mitigated', 'accepted', 'transferred')
  ),
  CONSTRAINT risk_treatments_type_check CHECK (
    treatment_type IS NULL OR treatment_type IN ('mitigate', 'accept', 'transfer', 'avoid')
  )
);

-- org-scoped list queries (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_risk_treatments_org_created
  ON risk_treatments (organization_id, created_at DESC, id DESC);

-- filter by risk_id within org
CREATE INDEX IF NOT EXISTS idx_risk_treatments_org_risk
  ON risk_treatments (organization_id, risk_id);

-- filter by status within org
CREATE INDEX IF NOT EXISTS idx_risk_treatments_org_status
  ON risk_treatments (organization_id, status);

-- ---------------------------------------------------------------
-- Expand evidence.source_type CHECK to include:
--   'dependency_review' — supported by app code since dependency-review-workflow
--   'risk_treatment'    — this package
-- ---------------------------------------------------------------

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_source_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_type_check
    CHECK (source_type IN (
      'control_test',
      'vendor_review',
      'ai_review',
      'obligation_review',
      'dependency_review',
      'risk_treatment'
    ));
