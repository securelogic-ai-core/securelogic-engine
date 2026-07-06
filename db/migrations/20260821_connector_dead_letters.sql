-- Migration: connector dead-letter capture + recovery (ERIP Epic 2, E2b)
-- Package: Enterprise Risk Intelligence Platform — Epic 2 (Enterprise Discovery & Connectors)
-- Design authority: docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md (ERIP-AD-14 recovery)
--
-- connector_dead_letters — the per-org dead-letter ledger. When a connector
-- operation fails TERMINALLY (a connector_sync job exhausts retries, or a
-- writeback intent exhausts its push attempts), the worker records an event
-- here with enough context for an operator to inspect and RE-DRIVE it:
--   * source        — which pipeline failed (connector_sync | connector_writeback)
--   * ref_id        — the failed jobs.id or connector_writeback_intents.id
--   * connector_id  — the connector involved
--   * payload       — the re-drive snapshot (e.g. { connector_id } for a sync)
--   * error/attempts— the terminal failure detail (never carries credentials)
--
-- Re-drive re-enqueues the operation (a fresh connector_sync job, or the intent
-- flipped back to pending) and marks the event 'redriven'. 'ignored' lets an
-- operator dismiss a dead-letter without re-driving. Forward-only status;
-- event-log semantics (a re-driven op that fails again is a NEW event).
--
-- Capture is passive — it only ever runs inside the sync/writeback workers,
-- which are themselves feature-flag gated; there is no capture without the
-- upstream feature enabled. The recovery routes sit behind the connectors chain
-- (ECL + EAR), dark in production.
--
-- Tenant model: standard NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML — the 20260807/20260820 pattern. Additive.
--
-- Rollback (manual, forward-only convention):
--   DROP TABLE connector_dead_letters;

CREATE TABLE IF NOT EXISTS connector_dead_letters (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source                TEXT        NOT NULL CHECK (source IN ('connector_sync', 'connector_writeback')),
  connector_id          TEXT        NOT NULL,
  -- The failed jobs.id (sync) or connector_writeback_intents.id (writeback).
  ref_id                UUID        NULL,
  -- Writeback context (NULL for sync failures).
  external_ref          TEXT        NULL,
  field                 TEXT        NULL,
  attempts              INTEGER     NOT NULL DEFAULT 0,
  error                 TEXT        NULL,
  -- Re-drive snapshot (bounded; never credentials).
  payload               JSONB       NULL,
  status                TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'redriven', 'ignored')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ NULL,
  resolved_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL
);

-- Operator triage: open dead-letters per org, newest first.
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_open
  ON connector_dead_letters (organization_id, created_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_org_conn
  ON connector_dead_letters (organization_id, connector_id);

ALTER TABLE connector_dead_letters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'connector_dead_letters'
       AND policyname = 'connector_dead_letters_tenant_isolation'
  ) THEN
    CREATE POLICY connector_dead_letters_tenant_isolation ON connector_dead_letters
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON connector_dead_letters TO app_request;
