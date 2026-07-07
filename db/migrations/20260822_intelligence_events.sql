-- Migration: intelligence_events
-- Package: Intelligence Pipeline Hardening / IE.P3
-- Memo: docs/architecture/erip/IE-INTELLIGENCE-EVENTS-MEMO.md
--
-- Creates the canonical Intelligence Event layer that many cyber_signals
-- (across sources and across the global / per-org partitions) collapse into:
--
--   intelligence_events           — one durable, evolving event per canonical_key
--   intelligence_event_sources    — the corroboration ledger (attribution, forever)
--   intelligence_event_timeline   — append-only chronological event history
--
-- GLOBAL / org-agnostic (like cyber_signals global rows, feed_health, sources):
-- these are derived external-intelligence tables, NOT customer data. No
-- organization_id, NO row-level security (rlsStatus 'none' in dataClassification.ts).
-- Per-org relevance stays where it is today (matcher fan-out + brief read); this
-- layer is the shared spine those per-org surfaces cite. IE-AD-1.
--
-- DARK: nothing writes or reads these tables until the projection ships behind
-- SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED (default off). Additive + idempotent.
--
-- Reversible:
--   DROP TABLE IF EXISTS intelligence_event_timeline;
--   DROP TABLE IF EXISTS intelligence_event_sources;
--   DROP TABLE IF EXISTS intelligence_events;

-- ---------------------------------------------------------------
-- intelligence_events — canonical evolving event
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Deterministic identity (eventCanonicalKey): cve:… / fp:… / sig:<dedup_hash>.
  -- UNIQUE so re-projection of a signal updates the SAME event (never duplicates).
  canonical_key      TEXT        NOT NULL UNIQUE,

  -- Normalized, display-safe primary fields (never raw feed text). IE-AD-5/6.
  title              TEXT        NOT NULL,
  executive_summary  TEXT        NOT NULL DEFAULT '',
  -- Content-quality of executive_summary: complete | truncated | degraded.
  summary_status     TEXT        NOT NULL DEFAULT 'complete',

  -- Dominant signal_type (taxonomy) + peak severity across contributors.
  event_type         TEXT        NOT NULL,
  severity           TEXT        NOT NULL,
  -- Derived lifecycle state (see intelligenceEventLifecycle.ts):
  -- new | corroborating | confirmed | actively_exploited | mitigated | resolved | archived.
  status             TEXT        NOT NULL DEFAULT 'new',
  -- Accumulated evidence flags — persisted so the derived lifecycle is reproducible.
  ever_exploited     BOOLEAN     NOT NULL DEFAULT FALSE,
  ever_patched       BOOLEAN     NOT NULL DEFAULT FALSE,

  affected_cve       TEXT        NULL,
  affected_vendor    TEXT        NULL,

  -- Corroboration rollup.
  source_count       INTEGER     NOT NULL DEFAULT 0,
  confidence         INTEGER     NOT NULL DEFAULT 0,

  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision           INTEGER     NOT NULL DEFAULT 0,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intelligence_events_severity_check
    CHECK (severity IN ('Critical', 'High', 'Moderate', 'Low')),
  CONSTRAINT intelligence_events_status_check
    CHECK (status IN (
      'new', 'corroborating', 'confirmed', 'actively_exploited',
      'mitigated', 'resolved', 'archived'
    )),
  CONSTRAINT intelligence_events_summary_status_check
    CHECK (summary_status IN ('complete', 'truncated', 'degraded')),
  CONSTRAINT intelligence_events_confidence_range
    CHECK (confidence >= 0 AND confidence <= 100)
);

-- Newest-first browse and severity/status filters.
CREATE INDEX IF NOT EXISTS idx_intelligence_events_last_seen
  ON intelligence_events (last_seen_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_events_severity
  ON intelligence_events (severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_events_cve
  ON intelligence_events (affected_cve)
  WHERE affected_cve IS NOT NULL;

-- ---------------------------------------------------------------
-- intelligence_event_sources — corroboration ledger (never lose attribution)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_event_sources (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID        NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,

  -- Nullable + SET NULL so the attribution row outlives the signal it points to
  -- (GDPR purge / cleanup). source + external_id are denormalised for that reason.
  cyber_signal_id       UUID        NULL REFERENCES cyber_signals(id) ON DELETE SET NULL,
  source                TEXT        NOT NULL,
  external_id           TEXT        NULL,

  relation              TEXT        NOT NULL,
  confidence            INTEGER     NULL,
  first_contributed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_contributed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Times this specific signal re-reported (idempotent re-projection bumps this).
  revision              INTEGER     NOT NULL DEFAULT 1,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_sources_relation_check
    CHECK (relation IN ('canonical', 'corroborating')),
  -- One ledger row per contributing signal; guards against duplicate inserts.
  CONSTRAINT event_sources_unique UNIQUE (event_id, cyber_signal_id)
);

CREATE INDEX IF NOT EXISTS idx_event_sources_event
  ON intelligence_event_sources (event_id);
CREATE INDEX IF NOT EXISTS idx_event_sources_signal
  ON intelligence_event_sources (cyber_signal_id);
CREATE INDEX IF NOT EXISTS idx_event_sources_source
  ON intelligence_event_sources (source);

-- ---------------------------------------------------------------
-- intelligence_event_timeline — append-only chronological history
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_event_timeline (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID        NOT NULL REFERENCES intelligence_events(id) ON DELETE CASCADE,

  entry_type       TEXT        NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL,
  summary          TEXT        NOT NULL,
  source           TEXT        NULL,
  cyber_signal_id  UUID        NULL REFERENCES cyber_signals(id) ON DELETE SET NULL,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_timeline_entry_type_check
    CHECK (entry_type IN (
      'first_seen',
      'corroborated',
      'new_advisory',
      'exploit_activity',
      'patch_available',
      'severity_change',
      'status_change'
    ))
);

-- Chronological read of one event's timeline.
CREATE INDEX IF NOT EXISTS idx_event_timeline_event_time
  ON intelligence_event_timeline (event_id, occurred_at DESC, id DESC);
