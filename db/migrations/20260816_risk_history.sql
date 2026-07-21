-- Migration: risk_history (ERIP raised-bar, F2)
-- Package: Enterprise Risk Intelligence Platform — history persistence
-- Design authority: raised-bar directive 2026-07-06 (trends + predictive history)
--
-- Per-org, per-dimension daily snapshot of the derived risk rollup (ERIP-AD-15:
-- derived, recomputable — never a source of truth). Feeds Executive trends/KPIs
-- (E4) and the predictive pipeline's feature store + retraining (E5). One row
-- per (org, snapshot_date, dimension); a re-snapshot on the same day upserts.
--
--   dimension        — 'enterprise' for the org rollup, else an asset_type.
--   asset_count / at_risk_count / max_risk / avg_risk — the DimensionRollup
--                      numbers at snapshot time.
--   bands            — the Critical/High/Moderate/Low/None distribution (JSONB;
--                      a distribution snapshot, not a compliance-load-bearing
--                      attribute — the S0 rule is respected).
--
-- Tenant model: standard NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML — the 20260807 pattern. Additive only.
-- Written only by the snapshot worker, gated on the risk-intelligence flag.
--
-- Rollback (manual, forward-only convention): DROP TABLE risk_history.

CREATE TABLE IF NOT EXISTS risk_history (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date    DATE        NOT NULL,
  dimension        TEXT        NOT NULL,
  asset_count      INTEGER     NOT NULL DEFAULT 0,
  at_risk_count    INTEGER     NOT NULL DEFAULT 0,
  max_risk         INTEGER     NOT NULL DEFAULT 0,
  avg_risk         INTEGER     NOT NULL DEFAULT 0,
  bands            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, snapshot_date, dimension)
);

CREATE INDEX IF NOT EXISTS idx_risk_history_org_dim_date
  ON risk_history (organization_id, dimension, snapshot_date);

ALTER TABLE risk_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'risk_history'
       AND policyname = 'risk_history_tenant_isolation'
  ) THEN
    CREATE POLICY risk_history_tenant_isolation ON risk_history
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON risk_history TO app_request;
