-- 20260721_enterprise_relationships_rls.sql
--
-- A04-G1 RLS: enable row-level security on enterprise_relationships (ECL Slice 2).
--
-- Org-owned (organization_id NOT NULL). The route family (enterpriseRelationships.ts)
-- is asTenant()-wrapped and there is no background/elevated writer in Slice 2, so the
-- policy preserves the "policy => writers tenant-safe" invariant.
--
-- NOT FORCE — owner bypasses; INERT until the app_request flip. NULLIF cast mandatory
-- (pooled app_request resets the GUC to '' not NULL). Same shape as enterprise_entities.

ALTER TABLE enterprise_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_relationships_tenant_isolation ON enterprise_relationships;

CREATE POLICY enterprise_relationships_tenant_isolation ON enterprise_relationships
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Tier-C DML grant for the non-owner app_request role. Tables created AFTER
-- 20260621 (the last grant migration) are not covered by the central grant list, so
-- a new table + its RLS policy must grant explicitly — otherwise app_request hits
-- "permission denied" instead of being RLS-filtered. Bare GRANT matches the
-- 20260621 idiom (the role is guaranteed to exist post-20260618; GRANT is idempotent).
GRANT SELECT, INSERT, UPDATE, DELETE ON enterprise_relationships TO app_request;
