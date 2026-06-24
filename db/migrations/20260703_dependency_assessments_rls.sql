-- 20260703_dependency_assessments_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on dependency_assessments.
-- 18th RLS table.
--
-- Safe to enable now: every reader and writer is tenant-safe at the
-- owner->app_request DATABASE_URL flip:
--   - dependencyAssessments.ts (POST/GET/GET/PATCH — the only writer) is now
--     asTenant()-wrapped. POST + PATCH run their own explicit pg.connect() tx;
--     under the wrap those nest as SAVEPOINTs (createSavepointClient) and
--     client.release() is a no-op.
--   - evidence.ts reads it in its asTenant()-wrapped POST preflight.
--   - intelligence.ts reads it (affected-entities JOIN) in its asTenant()-wrapped
--     POST /summary handler.
-- Preserves the "policy => readers+writers tenant-safe" invariant.
--
-- organization_id is NOT NULL. NOT FORCE — owner bypasses; INERT until the flip.

ALTER TABLE dependency_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dependency_assessments_tenant_isolation ON dependency_assessments;

CREATE POLICY dependency_assessments_tenant_isolation ON dependency_assessments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
