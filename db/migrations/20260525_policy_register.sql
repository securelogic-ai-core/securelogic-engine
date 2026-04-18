-- Migration: policy_register
-- Sprint 11 — adds policies, policy_control_links, and extends evidence source_type.
--
-- New tables:
--   policies              — organizational policy documents with review lifecycle
--   policy_control_links  — many-to-many: policies ↔ controls
--
-- Evidence change:
--   Drops and re-adds evidence_source_type_check to include 'policy_review'.

-- ---------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS policies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  description      TEXT,
  category         TEXT        NOT NULL DEFAULT 'other'
    CHECK (category IN (
      'access_control',
      'incident_response',
      'change_management',
      'data_classification',
      'business_continuity',
      'acceptable_use',
      'vendor_management',
      'vulnerability_management',
      'other'
    )),
  version          TEXT,
  owner            TEXT,
  status           TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'under_review', 'retired')),
  review_frequency TEXT
    CHECK (review_frequency IN ('annual', 'biannual', 'ad_hoc')),
  last_reviewed_at DATE,
  next_review_at   DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policies_org
  ON policies (organization_id);

CREATE INDEX IF NOT EXISTS idx_policies_org_status
  ON policies (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_policies_next_review
  ON policies (organization_id, next_review_at)
  WHERE next_review_at IS NOT NULL;

-- ---------------------------------------------------------------
-- policy_control_links
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS policy_control_links (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id  UUID        NOT NULL REFERENCES policies(id)  ON DELETE CASCADE,
  control_id UUID        NOT NULL REFERENCES controls(id)  ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, control_id)
);

CREATE INDEX IF NOT EXISTS idx_pcl_policy
  ON policy_control_links (policy_id);

CREATE INDEX IF NOT EXISTS idx_pcl_control
  ON policy_control_links (control_id);

-- ---------------------------------------------------------------
-- evidence source_type — add 'policy_review'
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
    'ai_governance_review',
    'dependency_review',
    'risk_treatment',
    'finding',
    'policy_review'
  ));
