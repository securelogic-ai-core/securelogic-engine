-- 20260715_risk_approvals_rls.sql
--
-- A04-G1 phase-3 RLS scaffolding for risk_approvals (Epic R1 scaffold).
--
-- Writers/readers are Epic R2 (riskApprovals.ts), which will run inside
-- asTenant()-wrapped tenant transactions. Enabling the policy now (inert) keeps
-- the table consistent with the platform tenant-isolation standard from birth,
-- so R2 needs no separate RLS migration.
--
-- organization_id is NOT NULL. NOT FORCE — owner bypasses; INERT until the
-- owner->app_request DATABASE_URL flip. Template: 20260703_risk_treatments_rls.sql.
-- Idempotent; safe to re-run.

ALTER TABLE risk_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_approvals_tenant_isolation ON risk_approvals;

CREATE POLICY risk_approvals_tenant_isolation ON risk_approvals
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
