-- 20261048_asset_origins.sql
--
-- PLAT-ASSET-1 v1: durable provenance for automatically created assets.
--
-- AUTHORITY: the PLAT-ASSET-1 operator ruling (2026-08-22): "Every
-- auto-created asset must preserve source provenance, source identity,
-- identity scheme, first-observed timestamp and originating
-- integration/import/run where available."
--
-- WHY A SIDECAR TABLE (architect ruling C):
--   * Audit events alone fail the requirement — security_audit_log is an
--     event stream with its own retention and read semantics, not queryable
--     product data, and "where did this asset come from?" is a product
--     question a customer asks on the asset page.
--   * Columns on the detail tables would smear four schemas (plus every
--     future backing kind), and origin is not an attribute of the RESOURCE —
--     it is a fact about how SecureLogic LEARNED of it. That is precisely
--     the sidecar-over-canonical shape ERIP-AD-8 established for
--     observations.
--   One sidecar keyed asset_id UNIQUE covers every backing kind with one
--   write site. Audit events are STILL written per creation — this table and
--   the audit trail answer different questions and both are kept.
--
-- One row per AUTO-created asset, written in the same tenant transaction as
-- the creation itself. Manually created and connector-created assets carry
-- no row here in v1 — absence means "not machine-created by identity
-- resolution", which is the honest default for everything that came before.
--
-- ON DELETE: CASCADE with the asset — the origin describes the registry row
-- and must never block the (already occurrence-guarded) asset deletion path.
-- scan_run_id is SET NULL: runs are never deleted today, but the origin must
-- outlive any future run pruning.
--
-- Grants: SELECT, INSERT only. An origin is never edited and never deleted
-- by a request path — asserted once, at creation, forever (the
-- asset_identifiers no-UPDATE philosophy, applied whole).

CREATE TABLE IF NOT EXISTS asset_origins (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id           UUID        NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,

  -- HOW the platform came to create this asset. v1 has exactly one writer;
  -- future automatic-creation lanes (e.g. connector identity resolution)
  -- widen this CHECK in their own migration, with their own authority.
  created_via        TEXT        NOT NULL CHECK (created_via IN ('scan_import')),

  -- Source identity: the same free-text source vocabulary the scan lane uses
  -- (vulnerability_scan_runs.source_key — free text BY RULING, 20261035).
  source_key         TEXT        NOT NULL CHECK (length(trim(source_key)) > 0),
  external_run_id    TEXT        NULL,
  scan_run_id        UUID        NULL REFERENCES vulnerability_scan_runs(id) ON DELETE SET NULL,

  -- The identity that justified the creation: scheme mirrors the 20261033
  -- CHECK; value is the NORMALIZED form (assetStrongIdentity.ts) — the same
  -- string stored in asset_identifiers.
  scheme             TEXT        NOT NULL CHECK (scheme IN (
                       'internal_id', 'hostname', 'fqdn', 'ip', 'mac',
                       'cloud_resource_id', 'instance_id',
                       'application_id', 'scanner_asset_id'
                     )),
  value              TEXT        NOT NULL CHECK (length(trim(value)) > 0),

  -- When SecureLogic first observed the source asset — creation time, by
  -- construction: the row is written in the creating transaction.
  first_observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_origins_org
  ON asset_origins (organization_id);

-- "Which assets did this run create?" — the import-forensics read.
CREATE INDEX IF NOT EXISTS idx_asset_origins_org_run
  ON asset_origins (organization_id, scan_run_id)
  WHERE scan_run_id IS NOT NULL;

ALTER TABLE asset_origins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_origins_tenant_isolation ON asset_origins;
CREATE POLICY asset_origins_tenant_isolation ON asset_origins
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT ON asset_origins TO app_request;

COMMENT ON TABLE asset_origins IS
  'PLAT-ASSET-1 provenance sidecar: one row per AUTOMATICALLY created asset — how SecureLogic learned of it (created_via + source_key + run), under which identity (scheme + normalized value), and when it was first observed. Written in the creating transaction; never updated, never deleted by a request path. Absence means the asset was not machine-created by identity resolution.';
