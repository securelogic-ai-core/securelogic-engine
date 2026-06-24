-- 20260702_ai_system_vendor_dependencies_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on ai_system_vendor_dependencies.
--
-- Safe to enable now: the table's ENTIRE route family (aiSystemVendorDependencies.ts
-- — POST / DELETE / GET ai-systems→vendors / GET vendors→ai-systems) is
-- asTenant()-wrapped, and the table is written ONLY by those routes (no matcher/
-- pgElevated writer), so wrapping the family is full coverage. Preserves the
-- "policy ⟹ routes wrapped" invariant at the owner→app_request DATABASE_URL flip.
--
-- Rows are org-owned: organization_id is NOT NULL. NOT FORCE — owner bypasses;
-- INERT until the flip. Identical pattern to the signal_*_links tables.

ALTER TABLE ai_system_vendor_dependencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_system_vendor_dependencies_tenant_isolation ON ai_system_vendor_dependencies;

CREATE POLICY ai_system_vendor_dependencies_tenant_isolation ON ai_system_vendor_dependencies
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
