-- Migration: connector writeback intents (ERIP Epic 2, E2a — bidirectional sync)
-- Package: Enterprise Risk Intelligence Platform — Epic 2 (Enterprise Discovery & Connectors)
-- Design authority: docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md (ERIP-AD-12 writeback)
--
-- connector_writeback_intents — the per-org outbound writeback queue + state.
-- Discovery (E2.P1–P4) reads FROM external systems; writeback pushes selected,
-- whitelisted fields BACK to the source record (full bidirectional sync where
-- the adapter supports it). Each intent asserts one external field value on one
-- external record and carries its own optimistic-concurrency baseline so the
-- writeback worker can detect external drift and resolve conflicts
-- deterministically (connectorWritebackCore.decideWriteback):
--
--   * last_pushed_value  — the value WE last wrote (null before the first push).
--   * external_prev_value — the external system's value at the last apply
--                           (provenance / audit — what we overwrote).
--
-- Policy: external_current == desired → noop-adopt; last_pushed null OR
-- external_current == last_pushed → apply (we own the field, no external
-- drift); otherwise → conflict (someone changed it externally after our last
-- push) — HELD, never overwritten, surfaced for operator resolution.
--
-- The `field` is the adapter's whitelisted EXTERNAL column name and
-- `desired_value` is the literal string to write — exact-string comparison
-- makes conflict detection sound. The adapter's writeback whitelist is the only
-- admission gate for which fields may be mutated externally.
--
-- Tenant model: standard NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML — the 20260807/20260812 pattern. Additive.
--
-- Rollback (manual, forward-only convention):
--   DROP TABLE connector_writeback_intents;

CREATE TABLE IF NOT EXISTS connector_writeback_intents (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id          TEXT        NOT NULL,
  -- Target external record (the connector's record id — same identity space as
  -- connector_asset_observations.external_ref) and the external field to write.
  external_ref          TEXT        NOT NULL,
  field                 TEXT        NOT NULL,
  desired_value         TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'applied', 'conflict', 'failed')),
  attempts              INTEGER     NOT NULL DEFAULT 0,
  max_attempts          INTEGER     NOT NULL DEFAULT 5,
  -- Transient-failure backoff watermark; NULL = due immediately.
  next_attempt_at       TIMESTAMPTZ NULL,
  -- Optimistic-concurrency baselines (see header).
  last_pushed_value     TEXT        NULL,
  external_prev_value   TEXT        NULL,
  -- Error / conflict detail (bounded; never echoes credentials).
  detail                TEXT        NULL,
  source                TEXT        NOT NULL DEFAULT 'operator'
                          CHECK (source IN ('operator', 'engine')),
  requested_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ NULL,
  -- One LIVE intent per (org, connector, external record, field): re-enqueuing
  -- the same field supersedes the prior desired value in place.
  UNIQUE (organization_id, connector_id, external_ref, field)
);

-- Due-scan support: pending intents past their backoff, per (org, connector).
CREATE INDEX IF NOT EXISTS idx_connector_writeback_due
  ON connector_writeback_intents (organization_id, connector_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_connector_writeback_org_ref
  ON connector_writeback_intents (organization_id, connector_id, external_ref);

ALTER TABLE connector_writeback_intents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'connector_writeback_intents'
       AND policyname = 'connector_writeback_intents_tenant_isolation'
  ) THEN
    CREATE POLICY connector_writeback_intents_tenant_isolation ON connector_writeback_intents
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON connector_writeback_intents TO app_request;
