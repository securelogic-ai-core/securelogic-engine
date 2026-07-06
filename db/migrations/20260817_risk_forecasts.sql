-- Migration: risk_forecasts (ERIP Epic 5, Predictive Intelligence)
-- Package: Enterprise Risk Intelligence Platform — predictive pipeline (E5a)
-- Design authority: raised-bar directive 2026-07-06; ERIP-AD-21 (deterministic,
-- explainable, reproducible forecasting).
--
-- Persisted per-org forecasts of a dimension's risk metric at a horizon. The
-- inference worker re-fits OLS + Holt on the latest history window each run and
-- upserts the winner here — the re-fit IS the retraining step (models improve
-- as history accumulates, with no trained weights to store). Derived +
-- recomputable (ERIP-AD-15). One row per (org, dimension, metric, horizon_days).
--
--   metric        — 'avg_risk' | 'at_risk_count' (the forecastable series).
--   method        — 'ols_linear' | 'holt_linear' (which model won the fit).
--   trend         — 'increasing' | 'decreasing' | 'stable' (factual, AD-23).
--   confidence    — 0–100 from fit quality × sample-size factor.
--   reasoning     — the explainability trace (JSONB array of strings).
--   sample_size   — history points the fit used.
--   forecast_date — the run date the forecast was produced on.
--
-- Tenant model: NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML — the 20260807 pattern. Additive only.
--
-- Rollback (manual, forward-only convention): DROP TABLE risk_forecasts.

CREATE TABLE IF NOT EXISTS risk_forecasts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dimension        TEXT        NOT NULL,
  metric           TEXT        NOT NULL CHECK (metric IN ('avg_risk', 'at_risk_count')),
  horizon_days     INTEGER     NOT NULL CHECK (horizon_days BETWEEN 1 AND 365),
  method           TEXT        NOT NULL CHECK (method IN ('ols_linear', 'holt_linear')),
  projected_value  NUMERIC(12,2) NOT NULL,
  trend            TEXT        NOT NULL CHECK (trend IN ('increasing', 'decreasing', 'stable')),
  confidence       SMALLINT    NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  in_sample_rmse   NUMERIC(12,2) NOT NULL DEFAULT 0,
  sample_size      INTEGER     NOT NULL DEFAULT 0,
  reasoning        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  forecast_date    DATE        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, dimension, metric, horizon_days)
);

CREATE INDEX IF NOT EXISTS idx_risk_forecasts_org
  ON risk_forecasts (organization_id, dimension);

ALTER TABLE risk_forecasts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'risk_forecasts'
       AND policyname = 'risk_forecasts_tenant_isolation'
  ) THEN
    CREATE POLICY risk_forecasts_tenant_isolation ON risk_forecasts
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON risk_forecasts TO app_request;
