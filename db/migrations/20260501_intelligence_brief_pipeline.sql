-- ============================================================
-- Intelligence Brief Pipeline
-- 2026-05-01
--
-- Three new tables:
--   intelligence_brief_sources  — platform-level source registry (no org FK)
--   intelligence_briefs         — org-scoped generated briefs
--   intelligence_brief_items    — individual signal items within a brief
--
-- Intentionally kept separate from posture, findings, and risk tables.
-- The brief pipeline reads from cyber_signals but does not write back
-- to posture or findings. cyber_signal_id is nullable FK for traceability.
-- ============================================================

-- ------------------------------------------------------------
-- 1. intelligence_brief_sources
--    Global registry of external sources the pipeline may draw from.
--    No organization_id — sources are platform-level config.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_brief_sources (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  url         TEXT        NOT NULL DEFAULT '',
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_brief_sources_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_brief_sources_active
  ON intelligence_brief_sources (active);

-- ------------------------------------------------------------
-- 2. intelligence_briefs
--    One brief per organisation per reporting period.
--    period_start / period_end define the signal window.
--    status: draft → published | failed
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_briefs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start     TIMESTAMPTZ NOT NULL,
  period_end       TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft',
  signal_count     INTEGER     NOT NULL DEFAULT 0,
  item_count       INTEGER     NOT NULL DEFAULT 0,
  content_json     JSONB       NOT NULL DEFAULT '{}',
  content_markdown TEXT        NOT NULL DEFAULT '',
  generated_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_briefs_status_check
    CHECK (status IN ('draft', 'generating', 'published', 'failed')),

  CONSTRAINT intelligence_briefs_period_check
    CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_briefs_org_period
  ON intelligence_briefs (organization_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_briefs_org_status
  ON intelligence_briefs (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_intelligence_briefs_created_at
  ON intelligence_briefs (created_at DESC);

-- ------------------------------------------------------------
-- 3. intelligence_brief_items
--    Individual signal entries within a brief.
--    category: vulnerability | threat_actor | vendor_incident | general
--    relevance: high | medium | low
--    cyber_signal_id nullable — item may be synthesised without a direct signal
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_brief_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brief_id          UUID        NOT NULL REFERENCES intelligence_briefs(id) ON DELETE CASCADE,
  cyber_signal_id   UUID        NULL REFERENCES cyber_signals(id) ON DELETE SET NULL,
  category          TEXT        NOT NULL,
  relevance         TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  summary           TEXT        NOT NULL DEFAULT '',
  affected_cve      TEXT        NULL,
  affected_vendor   TEXT        NULL,
  source_slug       TEXT        NULL,
  signal_type       TEXT        NULL,
  severity          TEXT        NULL,
  ingestion_timestamp TIMESTAMPTZ NULL,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_brief_items_category_check
    CHECK (category IN ('vulnerability', 'threat_actor', 'vendor_incident', 'general')),

  CONSTRAINT intelligence_brief_items_relevance_check
    CHECK (relevance IN ('high', 'medium', 'low'))
);

CREATE INDEX IF NOT EXISTS idx_brief_items_brief_id
  ON intelligence_brief_items (brief_id, sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_brief_items_org_category
  ON intelligence_brief_items (organization_id, category);

CREATE INDEX IF NOT EXISTS idx_brief_items_cyber_signal_id
  ON intelligence_brief_items (cyber_signal_id)
  WHERE cyber_signal_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Seed canonical sources
-- ------------------------------------------------------------

INSERT INTO intelligence_brief_sources (name, slug, description, url, active)
VALUES
  (
    'CISA Known Exploited Vulnerabilities',
    'cisa-kev',
    'CISA catalog of known exploited vulnerabilities requiring remediation by federal agencies and widely adopted as industry baseline.',
    'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    TRUE
  ),
  (
    'National Vulnerability Database',
    'nvd',
    'NIST NVD is the U.S. government repository of standards-based vulnerability management data using the Security Content Automation Protocol (SCAP).',
    'https://nvd.nist.gov/',
    TRUE
  )
ON CONFLICT (slug) DO NOTHING;
