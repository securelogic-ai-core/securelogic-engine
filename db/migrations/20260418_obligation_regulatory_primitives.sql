-- Migration: obligation_regulatory_primitives
-- Package: obligation-regulatory-primitives
-- Depends on: control-framework-primitives (requirements table),
--             platform-foundation-findings-actions-posture (org/findings conventions)
--
-- Introduces two tables:
--   1. obligations       — org-scoped regulatory/compliance obligations
--   2. obligation_mappings — links an obligation to an existing requirement
--
-- This package is structural only.
-- It does not produce findings, compute posture scores, or run assessments.
-- Those behaviors belong to obligation-assessment-workflow (Layer 3).
--
-- Org isolation:
--   obligations:         organization_id column (direct)
--   obligation_mappings: enforced at the application layer via:
--                          obligation_id → obligations.organization_id
--                          requirement_id → requirements → frameworks.organization_id
--                        (no direct org_id on the join table — same pattern as control_mappings)
--
-- IF NOT EXISTS justification:
--   Migrations are one-directional with no rollback mechanism.
--   Guard allows safe re-execution during development if a migration is partially applied.
--   In production (single-pass), each migration runs once — the guard is inert.

-- ============================================================
-- 1. OBLIGATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS obligations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title             TEXT        NOT NULL,
  description       TEXT,
  source_regulation TEXT,
  jurisdiction      TEXT,
  domain            TEXT,
  status            TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'waived', 'not_applicable')),
  priority          TEXT
                    CHECK (priority IS NULL OR priority IN
                           ('immediate', 'near_term', 'planned', 'watch')),
  due_date          DATE,
  owner_user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, title)
);

-- Org-scoped list queries
CREATE INDEX IF NOT EXISTS idx_obligations_org
  ON obligations (organization_id);

-- Status-filtered list queries
CREATE INDEX IF NOT EXISTS idx_obligations_org_status
  ON obligations (organization_id, status);

-- Owner assignment queries
CREATE INDEX IF NOT EXISTS idx_obligations_owner
  ON obligations (owner_user_id);

-- Due date ordering (for future Layer 4 read surfaces)
CREATE INDEX IF NOT EXISTS idx_obligations_org_due_date
  ON obligations (organization_id, due_date ASC NULLS LAST);

-- ============================================================
-- 2. OBLIGATION_MAPPINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS obligation_mappings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id  UUID        NOT NULL REFERENCES obligations(id) ON DELETE RESTRICT,
  requirement_id UUID        NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (obligation_id, requirement_id)
);

-- Requirements satisfied by an obligation
CREATE INDEX IF NOT EXISTS idx_obligation_mappings_obligation
  ON obligation_mappings (obligation_id);

-- Obligations that reference a requirement
CREATE INDEX IF NOT EXISTS idx_obligation_mappings_requirement
  ON obligation_mappings (requirement_id);
