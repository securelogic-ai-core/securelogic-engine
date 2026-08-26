-- Migration: ai_system_governance_links
-- Package:   AI Governance T2-B — the relationships the baseline calls the
--            platform's largest single sufficiency gap.
--
-- The baseline finding, verbatim: "The chain the program asks for — AI system
-- → applicable policy/regulation/framework → controls → evidence — cannot be
-- represented in the current schema at all. An AI-governance product that
-- cannot say which framework applies to which AI system is not an
-- AI-governance product." These four tables are that chain's missing edges.
--
-- ── FOUR TYPED TABLES, NOT ONE POLYMORPHIC ONE ──────────────────────────────
-- The platform's edge convention is typed: signal_control_links,
-- signal_obligation_links, signal_ai_system_links, ai_system_vendor_
-- dependencies, finding_risks — each edge kind is its own table with real FKs
-- on both ends. A single (target_type, target_id) table would buy fewer files
-- at the cost of FK integrity, per-edge CHECKs, and honest indexes — the
-- polymorphic-association trade the vendor<-finding linkage defect just
-- demonstrated the cost of. Four small identical tables is the cheap side.
--
-- ── WHAT AN EDGE MEANS (and what it does not) ───────────────────────────────
--   framework link    "this framework applies to this system" — a scoping
--                     declaration. Requirement-level coverage is NOT restated
--                     here: it already flows framework → requirements →
--                     control_mappings → controls, and an AI-system-specific
--                     restatement would drift from it.
--   control link      "this control governs this system" — the edge evidence
--                     and control_assessments hang off transitively.
--   policy link       "this policy covers this system".
--   obligation link   "this obligation binds this system".
--
-- Every link is a HUMAN declaration made through the API. Nothing creates one
-- automatically; a system with no links is exactly what it is today. (The
-- matcher may one day SUGGEST links — a suggestion would arrive as a separate
-- provisional object, per the finding_risks precedent, never as a row here.)
--
-- ── Tenancy ─────────────────────────────────────────────────────────────────
-- organization_id NOT NULL on every table; the routes verify BOTH endpoints
-- same-org with pre-flight SELECTs before insert (the ai_system_vendor_
-- dependencies pattern). All four targets — frameworks, controls, policies,
-- obligations — are org-scoped tables (frameworks carries organization_id
-- directly; verified in 20260415_control_framework_primitives.sql), so every
-- pre-flight checks ownership, not mere existence.
--
-- RLS + app_request grants at creation, per the post-20261023 house rule for
-- new tables. UPDATE is deliberately NOT granted anywhere: links are created
-- and deleted, never edited — an edit would silently re-point a governance
-- declaration, and re-pointing is a delete plus a create with two audit rows.

-- ============================================================
-- 1. AI SYSTEM ↔ FRAMEWORK
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_system_framework_links (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id       UUID        NOT NULL REFERENCES ai_systems(id) ON DELETE CASCADE,
  framework_id       UUID        NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  created_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ai_system_id, framework_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_system_framework_links_system
  ON ai_system_framework_links (organization_id, ai_system_id);
CREATE INDEX IF NOT EXISTS idx_ai_system_framework_links_framework
  ON ai_system_framework_links (organization_id, framework_id);

ALTER TABLE ai_system_framework_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_system_framework_links_tenant_isolation ON ai_system_framework_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON ai_system_framework_links TO app_request;

-- ============================================================
-- 2. AI SYSTEM ↔ CONTROL
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_system_control_links (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id       UUID        NOT NULL REFERENCES ai_systems(id) ON DELETE CASCADE,
  control_id         UUID        NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  created_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ai_system_id, control_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_system_control_links_system
  ON ai_system_control_links (organization_id, ai_system_id);
CREATE INDEX IF NOT EXISTS idx_ai_system_control_links_control
  ON ai_system_control_links (organization_id, control_id);

ALTER TABLE ai_system_control_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_system_control_links_tenant_isolation ON ai_system_control_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON ai_system_control_links TO app_request;

-- ============================================================
-- 3. AI SYSTEM ↔ POLICY
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_system_policy_links (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id       UUID        NOT NULL REFERENCES ai_systems(id) ON DELETE CASCADE,
  policy_id          UUID        NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  created_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ai_system_id, policy_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_system_policy_links_system
  ON ai_system_policy_links (organization_id, ai_system_id);
CREATE INDEX IF NOT EXISTS idx_ai_system_policy_links_policy
  ON ai_system_policy_links (organization_id, policy_id);

ALTER TABLE ai_system_policy_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_system_policy_links_tenant_isolation ON ai_system_policy_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON ai_system_policy_links TO app_request;

-- ============================================================
-- 4. AI SYSTEM ↔ OBLIGATION
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_system_obligation_links (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id       UUID        NOT NULL REFERENCES ai_systems(id) ON DELETE CASCADE,
  obligation_id      UUID        NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  created_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, ai_system_id, obligation_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_system_obligation_links_system
  ON ai_system_obligation_links (organization_id, ai_system_id);
CREATE INDEX IF NOT EXISTS idx_ai_system_obligation_links_obligation
  ON ai_system_obligation_links (organization_id, obligation_id);

ALTER TABLE ai_system_obligation_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_system_obligation_links_tenant_isolation ON ai_system_obligation_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON ai_system_obligation_links TO app_request;
