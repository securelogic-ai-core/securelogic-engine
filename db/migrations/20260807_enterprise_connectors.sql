-- Migration: enterprise_connectors
-- Package: Enterprise Asset Registry — Phase 3b (connector activation)
--
-- Per-org connector configuration for the nine R7 adapters (§3.4 REUSE row:
-- "wire the sync route"). One row = one (organization, connector) config.
--
--   config_encrypted — the adapter's validated config object, serialized and
--                      encrypted at the application layer (fieldEncryption.ts
--                      AES-256-GCM, the raw_payload/report_json precedent).
--                      Credentials NEVER stored plaintext when the key is set,
--                      never logged, never returned by any route (routes echo
--                      configured field KEYS only), and excluded from data
--                      exports (dataClassification exportExcludedColumns).
--   enabled          — the per-connector activation control. This replaces the
--                      "per-connector env flag" sketched in connectors/types.ts:
--                      env flags cannot scale per-org; a row-level toggle is the
--                      platform-correct call site. Default FALSE — configuring
--                      a connector does not activate it.
--   last_sync_*      — worker-maintained status surface for GET /api/connectors.
--
-- The connector_id CHECK mirrors REQUIRED_CONNECTOR_IDS (registry.ts) — unit
-- lockstep-asserted. Onboarding a new adapter requires a migration, which is
-- deliberate: an adapter is only reachable once its id is admitted here.
--
-- Tenant model: standard NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML — the 20260806 detail-table pattern.
-- Additive only; nothing existing changes behavior. All read/write paths are
-- double-fenced behind SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED AND
-- SECURELOGIC_ASSET_REGISTRY_ENABLED (both default off).
--
-- Rollback (manual, forward-only convention): DROP TABLE enterprise_connectors
-- — self-contained (no inbound FKs; jobs reference connectors by payload only).

CREATE TABLE IF NOT EXISTS enterprise_connectors (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id      TEXT        NOT NULL CHECK (connector_id IN (
                                  'servicenow_cmdb',
                                  'microsoft_defender',
                                  'crowdstrike_falcon',
                                  'wiz',
                                  'tenable',
                                  'qualys',
                                  'rapid7',
                                  'cloud_inventory',
                                  'identity_provider')),
  config_encrypted  TEXT        NOT NULL,
  enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
  last_sync_at      TIMESTAMPTZ NULL,
  last_sync_status  TEXT        NULL CHECK (last_sync_status IS NULL OR last_sync_status IN ('succeeded', 'failed')),
  last_sync_summary JSONB       NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_enterprise_connectors_org
  ON enterprise_connectors (organization_id);

ALTER TABLE enterprise_connectors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'enterprise_connectors'
       AND policyname = 'enterprise_connectors_tenant_isolation'
  ) THEN
    CREATE POLICY enterprise_connectors_tenant_isolation ON enterprise_connectors
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON enterprise_connectors TO app_request;
