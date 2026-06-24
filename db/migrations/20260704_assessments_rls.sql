-- 20260704_assessments_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on assessments.
-- 21st RLS table.
--
-- Safe to enable now: every reader and writer is tenant-safe at the
-- owner->app_request DATABASE_URL flip:
--   - assess.ts (the only writer) persists assessments + findings + reports
--     inside withTenant(orgId) — the persistAssessment() explicit pg.connect()
--     tx nests as savepoints on the tenant client, so the INSERT runs under the
--     app.current_org_id GUC and satisfies RLS WITH CHECK. (This wrap also
--     closes a latent pre-flip break on assess.ts's findings INSERT, since
--     findings already has RLS enabled.)
--   - assessments.ts (GET list / GET :id — the only readers) is asTenant()-wrapped.
-- Preserves the "policy => readers+writers tenant-safe" invariant.
--
-- organization_id is NOT NULL. NOT FORCE — owner bypasses; INERT until the flip.

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assessments_tenant_isolation ON assessments;

CREATE POLICY assessments_tenant_isolation ON assessments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
