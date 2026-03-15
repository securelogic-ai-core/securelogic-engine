CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, email)
);

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  criticality TEXT,
  current_risk_score NUMERIC(10,2),
  framework_coverage JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TABLE assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  framework TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  subject_name TEXT,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  intake_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  framework_control_id TEXT,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  risk_score NUMERIC(10,2),
  summary TEXT,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  export_formats JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  entitlement_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL DEFAULT 'intelligence-worker',
  external_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  published_at TIMESTAMPTZ,
  summary TEXT,
  raw_content TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact_score NUMERIC(10,2),
  novelty_score NUMERIC(10,2),
  relevance_score NUMERIC(10,2),
  priority NUMERIC(10,2),
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  analysis TEXT NOT NULL,
  risk_implication TEXT,
  recommendation TEXT,
  risk_level TEXT,
  audience TEXT,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  linked_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  score NUMERIC(10,2),
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trend_signals (
  trend_id UUID NOT NULL REFERENCES trends(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  PRIMARY KEY (trend_id, signal_id)
);

CREATE TABLE newsletter_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  publish_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  audience_tier TEXT NOT NULL DEFAULT 'free',
  summary TEXT,
  sections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_html TEXT,
  content_md TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE newsletter_issue_insights (
  issue_id UUID NOT NULL REFERENCES newsletter_issues(id) ON DELETE CASCADE,
  insight_id UUID NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  section_name TEXT,
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, insight_id)
);

CREATE TABLE subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE newsletter_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES newsletter_issues(id) ON DELETE CASCADE,
  subscriber_email TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE worker_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  signals_fetched INT NOT NULL DEFAULT 0,
  insights_generated INT NOT NULL DEFAULT 0,
  issues_generated INT NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX uq_signals_source_dedupe
  ON signals (source, COALESCE(external_id, ''), COALESCE(source_url, ''));

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_vendors_org ON vendors(organization_id);
CREATE INDEX idx_assessments_org ON assessments(organization_id);
CREATE INDEX idx_assessments_vendor ON assessments(vendor_id);
CREATE INDEX idx_findings_assessment ON findings(assessment_id);
CREATE INDEX idx_reports_assessment ON reports(assessment_id);
CREATE INDEX idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX idx_signals_category ON signals(category);
CREATE INDEX idx_signals_published_at ON signals(published_at DESC);
CREATE INDEX idx_insights_signal_id ON insights(signal_id);
CREATE INDEX idx_trends_category ON trends(category);
CREATE INDEX idx_newsletter_issues_status ON newsletter_issues(status);
CREATE INDEX idx_worker_runs_status ON worker_runs(status);
