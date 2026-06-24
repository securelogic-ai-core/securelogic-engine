-- 20260703_dependencies_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on dependencies.
-- 19th RLS table.
--
-- Safe to enable now: every reader and writer is tenant-safe at the
-- owner->app_request DATABASE_URL flip:
--   - dependencies.ts (POST/GET/GET/GET/PATCH — the only writer) is now
--     asTenant()-wrapped. POST + PATCH run their own explicit pg.connect() tx
--     (savepoint-safe under the wrap); the /summary GET's 3-query Promise.all was
--     serialized for the single tenant client.
--   - dashboard.ts, dependencyAssessments.ts, intelligence.ts all read
--     dependencies inside their asTenant()-wrapped handlers.
-- Preserves the "policy => readers+writers tenant-safe" invariant.
--
-- organization_id is NOT NULL. NOT FORCE — owner bypasses; INERT until the flip.

ALTER TABLE dependencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dependencies_tenant_isolation ON dependencies;

CREATE POLICY dependencies_tenant_isolation ON dependencies
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
