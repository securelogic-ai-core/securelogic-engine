-- 20260719_enterprise_entities_rls.sql
--
-- A04-G1 RLS: enable row-level security on the Enterprise Context Layer tables
-- enterprise_entities and enterprise_data_stores (Priority-5 Slice 1).
--
-- Both tables are org-owned: organization_id is NOT NULL on each (the child carries
-- its own denormalized organization_id, Tradeoff B1, so it gets the identical policy
-- shape as every other table rather than an EXISTS-parent policy).
--
-- Writer coverage (preserves the "policy => writers tenant-safe" invariant):
--   1. enterpriseEntities.ts routes — asTenant()-wrapped; every INSERT/UPDATE/DELETE
--      runs inside the request tenant transaction with app.current_org_id set, and
--      writes organization_id from req.organizationContext (never the body). Post-flip
--      these execute as app_request and are RLS-correct.
--   2. No background/elevated writer exists for these tables in Slice 1 (no matcher,
--      worker, or import path touches them — those are later slices). Full coverage.
--
-- NOT FORCE — the owner connection bypasses; policies are INERT until the owner ->
-- app_request DATABASE_URL flip. NULLIF cast is mandatory: the pooled app_request
-- connection resets the GUC to '' (empty string), not NULL, between checkouts, so a
-- bare cast would throw; NULLIF(...,'') maps '' -> NULL -> no rows (fail-closed).
-- Same policy shape as signal_match_suggestions and the signal_*_links tables.

ALTER TABLE enterprise_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_entities_tenant_isolation ON enterprise_entities;

CREATE POLICY enterprise_entities_tenant_isolation ON enterprise_entities
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);


ALTER TABLE enterprise_data_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enterprise_data_stores_tenant_isolation ON enterprise_data_stores;

CREATE POLICY enterprise_data_stores_tenant_isolation ON enterprise_data_stores
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
