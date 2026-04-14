-- Migration: dependency_primitives
-- Package: dependency-primitives
-- Depends on: organizations table (platform-foundation),
--             vendors (vendor-risk-primitives)
--
-- Adds the dependencies table.
-- Dependency records are org-scoped primitives tracking external dependencies
-- (software libraries, cloud services, infrastructure, APIs). Mutable.
-- No assessment workflow, no finding creation in this package.
--
-- This migration is additive. It does not alter any existing table.

-- ---------------------------------------------------------------
-- dependencies
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dependencies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  dependency_type  TEXT        NOT NULL,
  criticality      TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'active',
  vendor_id        UUID        NULL REFERENCES vendors(id) ON DELETE SET NULL,
  version          TEXT        NULL,
  description      TEXT        NULL,
  license          TEXT        NULL,
  external_ref     TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dep_type_check CHECK (
    dependency_type IN ('software_library', 'cloud_service', 'infrastructure', 'api', 'other')
  ),
  CONSTRAINT dep_criticality_check CHECK (
    criticality IN ('Critical', 'High', 'Moderate', 'Low')
  ),
  CONSTRAINT dep_status_check CHECK (
    status IN ('active', 'deprecated', 'under_review')
  ),
  CONSTRAINT dep_name_nonempty CHECK (
    length(trim(name)) > 0
  )
);

-- primary list access pattern: org-scoped by status
CREATE INDEX IF NOT EXISTS idx_dependencies_org_status
  ON dependencies (organization_id, status);

-- vendor filter
CREATE INDEX IF NOT EXISTS idx_dependencies_org_vendor
  ON dependencies (organization_id, vendor_id);

-- cursor pagination
CREATE INDEX IF NOT EXISTS idx_dependencies_org_created
  ON dependencies (organization_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------
-- Verification query (run after applying):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'dependencies'
--   ORDER BY ordinal_position;
-- ---------------------------------------------------------------
