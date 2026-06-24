-- 20260703_risk_treatments_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on risk_treatments.
-- 20th RLS table.
--
-- Safe to enable now: every reader and writer is tenant-safe at the
-- owner->app_request DATABASE_URL flip:
--   - riskTreatments.ts (POST/GET/GET/PATCH — the only writer) is now
--     asTenant()-wrapped. POST + PATCH run their own explicit pg.connect() tx
--     (savepoint-safe under the wrap; client.release() no-op).
--   - risks.ts, evidence.ts, intelligence.ts all read risk_treatments inside
--     their asTenant()-wrapped handlers.
-- Preserves the "policy => readers+writers tenant-safe" invariant.
--
-- organization_id is NOT NULL. NOT FORCE — owner bypasses; INERT until the flip.

ALTER TABLE risk_treatments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_treatments_tenant_isolation ON risk_treatments;

CREATE POLICY risk_treatments_tenant_isolation ON risk_treatments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
