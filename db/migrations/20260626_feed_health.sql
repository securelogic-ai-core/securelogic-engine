-- Migration: feed_health
-- Per-source ingestion health so feeds stop rotting silently. One row per
-- source string; updated on every fetch attempt by feedHealth.ts. Surfaced for
-- operators and used to alert when a source fails N consecutive runs.
--
-- Global (not org-scoped): a source is shared across all orgs. Keyed by `source`.
-- Additive table, reversible: DROP TABLE feed_health;

CREATE TABLE IF NOT EXISTS feed_health (
  source                TEXT        PRIMARY KEY,
  last_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at       TIMESTAMPTZ,
  last_item_count       INTEGER,
  consecutive_failures  INTEGER     NOT NULL DEFAULT 0,
  last_error            TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
