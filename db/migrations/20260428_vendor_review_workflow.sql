-- Migration: vendor_review_workflow
-- Package: vendor-review-workflow
-- Depends on: vendor-risk-primitives (vendors table),
--             platform-foundation-findings-actions-posture (findings table)
--
-- Adds the vendor_reviews table.
-- A vendor review is a mutable, org-scoped workflow record that tracks
-- an ongoing or periodic review of a vendor's risk posture. It is distinct
-- from vendor_assessments (point-in-time, immutable, always creates a finding).
--
-- FINDING CREATION RULE (enforced by application, not FK):
--   A finding is created ONLY on the FIRST PATCH transition into:
--     status = 'concerns_identified' OR status = 'critical_issues'
--   "First" is enforced by checking whether a finding with:
--     source_type = 'vendor_cycle_review' AND source_id = vendor_reviews.id
--   already exists before creating a new one.
--
--   A 'satisfactory' review never creates a finding.
--   No finding is created at POST.
--
--   Findings produced by this package use:
--     source_type = 'vendor_cycle_review'
--     source_id   = vendor_reviews.id  (NOT vendor_id)
--     domain      = 'Vendor Risk'
--
-- STATUS VALUES (exactly):
--   not_started | in_progress | satisfactory | concerns_identified | critical_issues
--
-- Finding-triggering statuses: concerns_identified, critical_issues
-- overall_severity is required when transitioning to a finding-triggering status.
--
-- This migration is additive. It does not alter any existing table beyond the
-- findings source_type CHECK constraint expansion (additive only).

-- ---------------------------------------------------------------
-- vendor_reviews
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_reviews (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id        UUID        NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'not_started',
  overall_severity TEXT        NULL,
  summary          TEXT        NULL,
  notes            TEXT        NULL,
  performed_at     DATE        NULL,
  reviewer_id      TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_reviews_status_check CHECK (
    status IN ('not_started', 'in_progress', 'satisfactory', 'concerns_identified', 'critical_issues')
  ),
  CONSTRAINT vendor_reviews_severity_check CHECK (
    overall_severity IS NULL OR overall_severity IN ('Critical', 'High', 'Moderate', 'Low')
  )
);

-- org-scoped list queries (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_org_created
  ON vendor_reviews (organization_id, created_at DESC, id DESC);

-- filter by vendor_id within org
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_org_vendor
  ON vendor_reviews (organization_id, vendor_id);

-- filter by status within org
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_org_status
  ON vendor_reviews (organization_id, status);

-- ---------------------------------------------------------------
-- Expand findings.source_type CHECK to include 'vendor_cycle_review'
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
      'obligation_review',
      'dependency_review',
      'signal',
      'manual',
      'risk'
    ));
