-- 20260828_cyber_signals_published_at.sql
-- IQP Q2 — Recency & Source Authority (Phase 1 audit defect #4).
--
-- cyber_signals had NO event-date column: recency was unrecoverably conflated
-- with ingestion time (ingestion_timestamp DEFAULT NOW()), so a years-old KEV
-- entry ingested today surfaced as "this week's" intelligence.
--
-- Additive only:
--   1. published_at TIMESTAMPTZ NULL — the SOURCE-AUTHORITATIVE event date
--      (KEV dateAdded, NVD published, EDGAR file_date, Federal Register
--      publication_date, RSS pubDate). NULL = unknown → consumers fall back
--      to ingestion_timestamp (byte-identical legacy behavior).
--   2. btree index for the flag-gated brief-window predicate.
--   3. One-time backfill from raw_payload date keys, exception-safe per row.
--
-- BACKFILL SAFETY (IQP Q2 hard rule): this backfill only RECORDS true event
-- dates on existing rows; nothing reads published_at until
-- SECURELOGIC_SIGNAL_RECENCY_ENABLED is turned on, and when it is, OLD dates
-- move rows OUT of the brief window — historical intelligence is suppressed,
-- never re-surfaced as new.

ALTER TABLE cyber_signals ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_cyber_signals_published_at
  ON cyber_signals (published_at);

-- Backfill: try known source date keys in priority order. Per-row exception
-- handling so a malformed date string can never abort the migration; rows
-- with unparseable/absent dates stay NULL (= ingestion-time fallback).
-- Bounds guard: reject dates before 1990 or more than 1 day in the future.
DO $$
DECLARE
  r RECORD;
  raw TEXT;
  parsed TIMESTAMPTZ;
BEGIN
  FOR r IN
    SELECT id,
           COALESCE(
             raw_payload->>'dateAdded',         -- CISA KEV
             raw_payload->>'published',         -- NVD
             raw_payload->>'pubDate',           -- RSS/Atom
             raw_payload->>'publication_date',  -- Federal Register
             raw_payload->>'file_date',         -- SEC EDGAR
             raw_payload->>'date'               -- generic
           ) AS candidate
    FROM cyber_signals
    WHERE published_at IS NULL
  LOOP
    raw := r.candidate;
    IF raw IS NULL OR raw = '' THEN
      CONTINUE;
    END IF;
    BEGIN
      parsed := raw::timestamptz;
      IF parsed >= TIMESTAMPTZ '1990-01-01'
         AND parsed <= NOW() + INTERVAL '1 day' THEN
        UPDATE cyber_signals SET published_at = parsed WHERE id = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Unparseable date string → leave NULL (ingestion-time fallback).
      NULL;
    END;
  END LOOP;
END $$;
