-- Migration: sources
-- Priority 4 / Phase 4B / story B1 — source qualification storage FOUNDATION.
--
-- One row per upstream signal source, keyed by the SAME canonical source id used
-- by feed_health.source and the registry SourceDescriptor.id — 13 ids total:
--   7 kind='api' from src/api/lib/signals/sourceRegistry.ts
--   6 kind='rss' from src/api/lib/feedAdapter/registry.ts
--
-- GLOBAL (not org-scoped): a source is shared across all orgs — the same tenancy
-- posture as feed_health. There is NO organization_id and therefore NO RLS
-- policy. This is a deliberate non-tenant table; see
-- docs/A04-G1-table-classification.md (global / non-tenant tables).
--
-- B1 is STORAGE ONLY. It seeds source id + kind. The qualification values
-- (authority, authority_tier, reliability) are populated by a LATER 4B story and
-- are intentionally left NULL here. No application code consumes this table in
-- B1 — it is inert until a flagged consumer lands.
--
-- Additive + idempotent. Reversible: DROP TABLE sources;

CREATE TABLE IF NOT EXISTS sources (
  source          TEXT        PRIMARY KEY,
  kind            TEXT        NOT NULL,
  authority       TEXT,
  authority_tier  SMALLINT,
  reliability     NUMERIC(5,2),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sources_kind_check
    CHECK (kind IN ('api', 'rss')),
  CONSTRAINT sources_authority_tier_check
    CHECK (authority_tier IS NULL OR authority_tier BETWEEN 1 AND 5),
  CONSTRAINT sources_reliability_check
    CHECK (reliability IS NULL OR (reliability >= 0 AND reliability <= 100))
);

-- One-shot backfill of the 13 known sources (id + kind only). ON CONFLICT keeps
-- the migration idempotent and never clobbers a later-qualified row.
INSERT INTO sources (source, kind) VALUES
  ('cisa_kev', 'api'),
  ('nvd', 'api'),
  ('sec_edgar', 'api'),
  ('federal_register', 'api'),
  ('cisa_alerts', 'api'),
  ('mitre_attack', 'api'),
  ('mitre_atlas', 'api'),
  ('bleepingcomputer', 'rss'),
  ('krebsonsecurity', 'rss'),
  ('sans_isc', 'rss'),
  ('nist_news', 'rss'),
  ('ftc_news', 'rss'),
  ('onc_healthit', 'rss')
ON CONFLICT (source) DO NOTHING;
