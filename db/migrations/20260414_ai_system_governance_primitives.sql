-- Migration: ai_system_governance_primitives
-- Package: ai-system-governance-primitives
-- Depends on: vendor-risk-primitives (can run in parallel with vendor-assessment-workflow)
--
-- Introduces two tables:
--   1. ai_systems        — org-scoped AI system inventory
--   2. governance_reviews — point-in-time governance review of an AI system
--
-- LINKAGE CONVENTION (enforced by application, not FK):
--   findings.source_type = 'ai_review'
--   findings.source_id   = governance_reviews.id   ← NOT ai_system_id
--
-- The AI system being reviewed is at governance_reviews.ai_system_id.
-- Do NOT write ai_system_id into findings.source_id for this source type.
-- This convention allows GET /api/governance-reviews/:id to return the exact
-- finding produced by a specific review via source_id equality.

-- ============================================================
-- 1. AI SYSTEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_systems (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  use_case            TEXT,
  owner_user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  model_type          TEXT,
  data_classification TEXT,
  deployment_status   TEXT,
  criticality         TEXT
                      CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low')),
  risk_classification TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

-- Org-scoped list queries
CREATE INDEX IF NOT EXISTS idx_ai_systems_org
  ON ai_systems (organization_id);

-- Criticality-filtered list queries
CREATE INDEX IF NOT EXISTS idx_ai_systems_org_criticality
  ON ai_systems (organization_id, criticality);

-- Owner assignment queries
CREATE INDEX IF NOT EXISTS idx_ai_systems_owner
  ON ai_systems (owner_user_id);

-- ============================================================
-- 2. GOVERNANCE REVIEWS
-- ============================================================

CREATE TABLE IF NOT EXISTS governance_reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id    UUID        NOT NULL REFERENCES ai_systems(id) ON DELETE RESTRICT,
  review_type     TEXT        NOT NULL,
  performed_at    DATE        NOT NULL DEFAULT CURRENT_DATE,
  reviewer_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  outcome         TEXT,
  summary         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List reviews for a specific AI system ordered by recency
CREATE INDEX IF NOT EXISTS idx_governance_reviews_ai_system_created
  ON governance_reviews (ai_system_id, created_at DESC);

-- List reviews for an org ordered by recency
CREATE INDEX IF NOT EXISTS idx_governance_reviews_org_created
  ON governance_reviews (organization_id, created_at DESC);

-- Composite for org + ai_system scoped queries
CREATE INDEX IF NOT EXISTS idx_governance_reviews_org_ai_system
  ON governance_reviews (organization_id, ai_system_id);
