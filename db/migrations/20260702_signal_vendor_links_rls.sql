-- 20260702_signal_vendor_links_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on signal_vendor_links.
--
-- Safe to enable now: the table's ENTIRE route family (signalVendorLinks.ts —
-- POST / DELETE / GET vendors→signals / GET signals→vendors) is asTenant()-
-- wrapped, and the table is written ONLY by those routes (no matcher/pgElevated
-- writer), so wrapping the family is full coverage. This preserves the
-- "policy ⟹ routes wrapped" invariant at the owner→app_request DATABASE_URL flip.
--
-- Link rows are org-owned: organization_id is NOT NULL (REFERENCES organizations
-- ON DELETE CASCADE). The global-signal visibility rule (cyber_signals.org_id IS
-- NULL is cross-org-visible) is unaffected — that lives on cyber_signals, which
-- has no RLS, so app_request reads it fully; this policy governs only the
-- org-owned LINK rows. NOT FORCE — owner bypasses; INERT until the flip.
--
-- Pattern identical to the risk-link RLS siblings (20260701_*): USING + WITH
-- CHECK on NULLIF(current_setting('app.current_org_id', true), '')::uuid (the
-- NULLIF guards the pooled app_request '' GUC → fail closed to zero rows, not 500).

ALTER TABLE signal_vendor_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signal_vendor_links_tenant_isolation ON signal_vendor_links;

CREATE POLICY signal_vendor_links_tenant_isolation ON signal_vendor_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
