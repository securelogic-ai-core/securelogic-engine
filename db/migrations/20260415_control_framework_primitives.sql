-- Migration: control_framework_primitives
-- Package: control-framework-primitives
-- Depends on: org-profile-context-weighting
--
-- Introduces four tables:
--   1. frameworks       — org-scoped compliance framework reference (e.g. NIST CSF 2.0, ISO 27001)
--   2. requirements     — individual requirements within a framework (e.g. ID.AM-1)
--   3. controls         — org-specific control implementations
--   4. control_mappings — links a control to a requirement it satisfies
--
-- This package is structural only.
-- It does not produce findings, compute scores, or evaluate posture.
-- Those behaviors belong to the control-assessment-workflow package.
--
-- Org isolation:
--   frameworks:       organization_id column (direct)
--   requirements:     enforced via framework_id → frameworks.organization_id (no direct org_id)
--   controls:         organization_id column (direct)
--   control_mappings: enforced via control_id → controls.organization_id (no direct org_id)
--
-- IF NOT EXISTS justification:
--   Migrations are one-directional with no rollback mechanism.
--   Guard allows safe re-execution during development if a migration is partially applied.
--   In production (single-pass), each migration runs once — the guard is inert.
--   Column additions in future migrations must use ALTER TABLE, never rely on this guard.

-- ============================================================
-- 1. FRAMEWORKS
-- ============================================================

CREATE TABLE IF NOT EXISTS frameworks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  version         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name, version)
);

-- Org-scoped list queries
CREATE INDEX IF NOT EXISTS idx_frameworks_org
  ON frameworks (organization_id);

-- ============================================================
-- 2. REQUIREMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS requirements (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id UUID        NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  reference_id TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (framework_id, reference_id)
);

-- List requirements for a framework
CREATE INDEX IF NOT EXISTS idx_requirements_framework
  ON requirements (framework_id);

-- ============================================================
-- 3. CONTROLS
-- ============================================================

CREATE TABLE IF NOT EXISTS controls (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  owner_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

-- Org-scoped list queries
CREATE INDEX IF NOT EXISTS idx_controls_org
  ON controls (organization_id);

-- Owner assignment queries
CREATE INDEX IF NOT EXISTS idx_controls_owner
  ON controls (owner_user_id);

-- ============================================================
-- 4. CONTROL_MAPPINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS control_mappings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id     UUID        NOT NULL REFERENCES controls(id) ON DELETE RESTRICT,
  requirement_id UUID        NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (control_id, requirement_id)
);

-- Look up requirements satisfied by a control
CREATE INDEX IF NOT EXISTS idx_control_mappings_control
  ON control_mappings (control_id);

-- Look up controls that satisfy a requirement
CREATE INDEX IF NOT EXISTS idx_control_mappings_requirement
  ON control_mappings (requirement_id);
