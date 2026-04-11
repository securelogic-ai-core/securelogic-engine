-- Migration: vendor_assessment_workflow
-- Package: vendor-assessment-workflow
-- Depends on: vendor-risk-primitives (vendors table with status column)
--
-- Introduces vendor_assessments as a structured, org-scoped record that
-- captures the result of a point-in-time vendor risk review.
--
-- LINKAGE CONVENTION (enforced by application, not FK):
--   findings.source_type = 'vendor_review'
--   findings.source_id   = vendor_assessments.id   ← NOT vendor_id
--
-- The vendor being reviewed is at vendor_assessments.vendor_id.
-- Do NOT write vendor_id into findings.source_id for this source type.
-- This convention allows GET /api/vendor-assessments/:id to return the exact
-- findings produced by a specific assessment via source_id equality.

CREATE TABLE IF NOT EXISTS vendor_assessments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id        UUID        NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  assessment_type  TEXT        NOT NULL,
  overall_severity TEXT        NOT NULL
                   CHECK (overall_severity IN ('Critical', 'High', 'Moderate', 'Low')),
  status           TEXT        NOT NULL DEFAULT 'completed'
                   CHECK (status IN ('completed')),
  summary          TEXT,
  notes            TEXT,
  performed_at     DATE        NOT NULL DEFAULT CURRENT_DATE,
  reviewer_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List assessments for an org ordered by recency
CREATE INDEX IF NOT EXISTS idx_vendor_assessments_org_created
  ON vendor_assessments (organization_id, created_at DESC);

-- List assessments for a specific vendor (within org)
CREATE INDEX IF NOT EXISTS idx_vendor_assessments_vendor_created
  ON vendor_assessments (vendor_id, created_at DESC);

-- Composite for org + vendor scoped queries
CREATE INDEX IF NOT EXISTS idx_vendor_assessments_org_vendor
  ON vendor_assessments (organization_id, vendor_id);
