-- 20260703_risk_settings_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on risk_settings.
-- 16th RLS table; core-entity-layer config table.
--
-- Safe to enable now: every reader and writer is tenant-safe at the
-- owner->app_request DATABASE_URL flip:
--   - riskSettings.ts GET + PUT (the only writer) is asTenant()-wrapped.
--   - risks.ts reads risk_settings inside an asTenant()-wrapped handler
--     (tenant-scoped).
--   - riskCadence.ts / riskSettingsValidation.ts are pure libs (no DB).
-- Preserves the "policy => readers+writers tenant-safe" invariant.
--
-- One row per org: organization_id is NOT NULL + UNIQUE. NOT FORCE — owner
-- bypasses; INERT until the flip.

ALTER TABLE risk_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_settings_tenant_isolation ON risk_settings;

CREATE POLICY risk_settings_tenant_isolation ON risk_settings
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
