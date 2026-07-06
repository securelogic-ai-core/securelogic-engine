-- Migration: connector asset observations + sync cursor (ERIP Epic 2, E2.P2)
-- Package: Enterprise Risk Intelligence Platform — Epic 2 (Enterprise Discovery & Connectors)
-- Design authority: docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md (ERIP-AD-8, ERIP-AD-10, ERIP-AD-11)
--
-- 1. connector_asset_observations — the per-org discovery-fact ledger
--    (ERIP-AD-8): which connector saw which external_ref, when, under what
--    name/lane. Drift (ERIP-AD-11), conflict/confidence (E2.P3), and owner
--    discovery (E2.P4) all derive from this table; canonical stores are NEVER
--    mutated by reconciliation. Engine-written only (sync worker); no public
--    write route.
--
--    connector_id carries NO CHECK mirror of REQUIRED_CONNECTOR_IDS —
--    deliberately: the 20260807 enterprise_connectors CHECK is the single
--    admission gate (a sync job can only exist for an admitted connector),
--    and duplicating the enum here would double the per-adapter migration
--    surface for zero integrity gain.
--
--    `metadata` JSONB is source-echo only (E2.P4) — NEVER compliance-load-
--    bearing attributes (ECL S0 rule); anything a workflow consumes must be
--    promoted to a typed column first.
--
-- 2. enterprise_connectors.sync_cursor — the per-(org,connector) incremental
--    watermark (ERIP-AD-10). NULL = next run is a FULL sync. Written by the
--    worker on success only.
--
-- Tenant model: standard NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML — the 20260807 pattern. Additive only.
--
-- Rollback (manual, forward-only convention):
--   DROP TABLE connector_asset_observations;
--   ALTER TABLE enterprise_connectors DROP COLUMN IF EXISTS sync_cursor;

CREATE TABLE IF NOT EXISTS connector_asset_observations (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id            TEXT        NOT NULL,
  external_ref            TEXT        NOT NULL,
  -- Which persistence lane the entity took (connectorSyncCore plan) and the
  -- type it landed as: lane 'detail' → detail table asset_type; lane 'import'
  -- → ECL import entity_type.
  lane                    TEXT        NOT NULL CHECK (lane IN ('detail', 'import')),
  entity_type             TEXT        NOT NULL,
  name                    TEXT        NOT NULL,
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when the ref was seen by a FULL sync (reconciliation baseline).
  last_full_sync_seen_at  TIMESTAMPTZ NULL,
  -- ERIP-AD-11: a FULL sync that no longer reports this ref marks it stale.
  -- Report-only — no canonical row is deleted or lifecycle-flipped.
  stale                   BOOLEAN     NOT NULL DEFAULT FALSE,
  -- E2.P3 (conflict/confidence) and E2.P4 (owner/metadata discovery) columns,
  -- shipped with the ledger so later phases are pure code:
  confidence              INTEGER     NULL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  owner_hint              TEXT        NULL,
  metadata                JSONB       NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, connector_id, external_ref)
);

CREATE INDEX IF NOT EXISTS idx_connector_observations_org_ref
  ON connector_asset_observations (organization_id, external_ref);

CREATE INDEX IF NOT EXISTS idx_connector_observations_stale
  ON connector_asset_observations (organization_id, connector_id)
  WHERE stale;

ALTER TABLE connector_asset_observations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'connector_asset_observations'
       AND policyname = 'connector_asset_observations_tenant_isolation'
  ) THEN
    CREATE POLICY connector_asset_observations_tenant_isolation ON connector_asset_observations
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON connector_asset_observations TO app_request;

ALTER TABLE enterprise_connectors
  ADD COLUMN IF NOT EXISTS sync_cursor JSONB NULL;
