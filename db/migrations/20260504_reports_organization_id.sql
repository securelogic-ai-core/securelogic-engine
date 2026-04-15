-- 20260504_reports_organization_id.sql
--
-- Adds organization_id to the reports table so reports can be scoped directly
-- to an organization without joining through assessments.
--
-- Strategy: non-breaking three-step addition.
--   1. Add column as nullable (avoids locking issues on non-empty tables).
--   2. Backfill from parent assessments row.
--   3. Add NOT NULL constraint + FK once all rows are populated.
--
-- The reports table currently has: assessment_id → assessments(id) CASCADE,
-- and assessments.organization_id is the authoritative org scope. This migration
-- makes organization_id a first-class column on reports as well.

-- ── Step 1: add nullable column ─────────────────────────────────────────────

ALTER TABLE reports
  ADD COLUMN organization_id UUID NULL;

-- ── Step 2: backfill from assessments ───────────────────────────────────────

UPDATE reports r
SET organization_id = a.organization_id
FROM assessments a
WHERE r.assessment_id = a.id;

-- ── Step 3: enforce NOT NULL + FK ────────────────────────────────────────────

ALTER TABLE reports
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE reports
  ADD CONSTRAINT reports_organization_id_fk
  FOREIGN KEY (organization_id)
  REFERENCES organizations(id)
  ON DELETE CASCADE;

-- Index for direct org-scoped queries.
CREATE INDEX idx_reports_organization_id ON reports (organization_id);
