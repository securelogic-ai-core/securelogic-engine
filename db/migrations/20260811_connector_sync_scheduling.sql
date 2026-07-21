-- Migration: connector sync scheduling (ERIP Epic 2, E2.P1)
-- Package: Enterprise Risk Intelligence Platform — Epic 2 (Enterprise Discovery & Connectors)
-- Design authority: docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md (ERIP-AD-9)
--
-- Additive columns on enterprise_connectors (20260807) enabling scheduled,
-- self-backing-off connector synchronization:
--
--   sync_interval_minutes — the org's chosen cadence for this connector.
--                           NULL = manual-only (today's behavior, the default).
--                           CHECK >= 15 mirrors SYNC_INTERVAL_MIN_MINUTES in
--                           src/api/lib/connectorScheduleCore.ts (unit lockstep).
--   next_sync_at          — when the scheduler may next enqueue a sync. NULL =
--                           due immediately (first tick after an interval is set).
--                           Written by the worker: normal cadence at enqueue,
--                           pushed out by backoff on failure.
--   consecutive_failures  — failed runs since the last success; drives the
--                           exponential backoff (reset to 0 on success).
--
-- Scheduling behavior is DARK: the scheduler scan runs only when
-- SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED is "true" IN ADDITION to the
-- existing double fence (SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED AND
-- SECURELOGIC_ASSET_REGISTRY_ENABLED). With the new flag off (default
-- everywhere) these columns are inert metadata — manual sync is unchanged.
--
-- Additive only; no existing column, constraint, policy, or grant changes.
-- RLS/grants on enterprise_connectors (20260807) cover the new columns as-is.
--
-- Rollback (manual, forward-only convention):
--   ALTER TABLE enterprise_connectors
--     DROP CONSTRAINT IF EXISTS enterprise_connectors_sync_interval_min,
--     DROP COLUMN IF EXISTS sync_interval_minutes,
--     DROP COLUMN IF EXISTS next_sync_at,
--     DROP COLUMN IF EXISTS consecutive_failures;
--   DROP INDEX IF EXISTS idx_enterprise_connectors_due;

ALTER TABLE enterprise_connectors
  ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NULL,
  ADD COLUMN IF NOT EXISTS next_sync_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'enterprise_connectors_sync_interval_min'
       AND conrelid = 'enterprise_connectors'::regclass
  ) THEN
    ALTER TABLE enterprise_connectors
      ADD CONSTRAINT enterprise_connectors_sync_interval_min
      CHECK (sync_interval_minutes IS NULL OR sync_interval_minutes >= 15);
  END IF;
END $$;

-- The scheduler's due-scan predicate, as a partial index: only rows that can
-- ever be due (enabled, interval set) are indexed.
CREATE INDEX IF NOT EXISTS idx_enterprise_connectors_due
  ON enterprise_connectors (next_sync_at)
  WHERE enabled AND sync_interval_minutes IS NOT NULL;
