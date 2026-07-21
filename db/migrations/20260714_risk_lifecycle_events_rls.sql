-- 20260714_risk_lifecycle_events_rls.sql
--
-- A04-G1 phase-3 RLS scaffolding for risk_lifecycle_events (Epic R1).
--
-- The only writer is riskLifecycle.ts (transition handler), which INSERTs
-- inside its asTenant()-wrapped tenant transaction; the only reader is the
-- lifecycle-events GET in the same router, also asTenant()-wrapped. Preserves
-- the "policy => readers+writers tenant-safe" invariant.
--
-- organization_id is NOT NULL. NOT FORCE — owner bypasses; INERT until the
-- owner->app_request DATABASE_URL flip. Follows the exact template used by
-- 20260703_risk_treatments_rls.sql. Idempotent; safe to re-run.

ALTER TABLE risk_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_lifecycle_events_tenant_isolation ON risk_lifecycle_events;

CREATE POLICY risk_lifecycle_events_tenant_isolation ON risk_lifecycle_events
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
