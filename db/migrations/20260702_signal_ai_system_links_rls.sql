-- 20260702_signal_ai_system_links_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on signal_ai_system_links.
--
-- Safe to enable now: the table's ENTIRE route family (signalAiSystemLinks.ts —
-- POST / DELETE / GET ai-systems→signals / GET signals→ai-systems) is
-- asTenant()-wrapped, and the table is written ONLY by those routes (no matcher/
-- pgElevated writer), so wrapping the family is full coverage. Preserves the
-- "policy ⟹ routes wrapped" invariant at the owner→app_request DATABASE_URL flip.
--
-- Link rows are org-owned: organization_id is NOT NULL. The global-signal rule
-- lives on cyber_signals (no RLS) and is unaffected. NOT FORCE — owner bypasses;
-- INERT until the flip. Identical pattern to 20260702_signal_vendor_links_rls.sql.

ALTER TABLE signal_ai_system_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signal_ai_system_links_tenant_isolation ON signal_ai_system_links;

CREATE POLICY signal_ai_system_links_tenant_isolation ON signal_ai_system_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
