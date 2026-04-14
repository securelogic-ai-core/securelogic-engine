-- Migration: evidence_primitives
-- Package: evidence-primitives
-- Depends on: organizations table (platform-foundation),
--             control_assessments (control-assessment-workflow),
--             vendor_assessments (vendor-assessment-workflow),
--             governance_reviews (ai-system-governance-primitives),
--             obligation_assessments (obligation-assessment-workflow)
--
-- Adds the evidence table.
-- Evidence records are org-scoped and attach metadata to assessment workflow
-- records. They are immutable after creation (no PATCH, no DELETE).
-- No file upload, no blob storage, no binary attachment handling.
--
-- This migration is additive. It does not alter any existing table.

-- ---------------------------------------------------------------
-- evidence
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evidence (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type      TEXT        NOT NULL,
  source_id        UUID        NOT NULL,
  title            TEXT        NOT NULL,
  description      TEXT        NULL,
  evidence_type    TEXT        NOT NULL,
  collected_at     DATE        NULL,
  collected_by     TEXT        NULL,
  external_ref     TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT evidence_source_type_check CHECK (
    source_type IN ('control_test', 'vendor_review', 'ai_review', 'obligation_review')
  ),
  CONSTRAINT evidence_type_check CHECK (
    evidence_type IN ('document', 'screenshot', 'log', 'test_result', 'interview', 'observation', 'policy', 'other')
  ),
  CONSTRAINT evidence_title_nonempty CHECK (
    length(trim(title)) > 0
  )
);

-- primary access pattern: org-scoped lookup by source_type + source_id
CREATE INDEX IF NOT EXISTS idx_evidence_org_source
  ON evidence (organization_id, source_type, source_id);

-- secondary: org-scoped list ordered by creation time (for id lookup)
CREATE INDEX IF NOT EXISTS idx_evidence_org_created
  ON evidence (organization_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------
-- Verification query (run after applying):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'evidence'
--   ORDER BY ordinal_position;
-- ---------------------------------------------------------------
