-- 20260701_risk_obligation_links_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on risk_obligation_links.
--
-- Safe to enable now because the table's ENTIRE route family (riskObligationLinks.ts)
-- is asTenant()-wrapped as of Wave 0d — POST / DELETE / GET (forward) /
-- GET (inverse). DELETE's terminal moved from the unbufferable
-- res.status(204).send() to res.status(200).json(...) so the β1.5 deferred-response
-- shim can buffer it; the other three end in a single status().json() already.
-- This preserves the "policy ⟹ routes wrapped" invariant: at the eventual
-- owner→app_request DATABASE_URL flip every read/write on this table carries
-- app.current_org_id, so the policy filters correctly rather than silently
-- returning zero rows.
--
-- organization_id is NOT NULL (REFERENCES organizations ON DELETE CASCADE), so no
-- row can dangle outside the policy. NOT FORCE — the owner connection still
-- bypasses (system/maintenance paths); INERT until the flip.
--
-- Identical pattern to 20260701_risk_control_links_rls.sql (its RR-4 sibling):
-- USING + WITH CHECK on NULLIF(current_setting('app.current_org_id', true), '')::uuid.
-- The NULLIF guards the pooled app_request case where the GUC resets to '' (not
-- NULL) — bare ''::uuid would 500 instead of failing closed to zero rows.

ALTER TABLE risk_obligation_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_obligation_links_tenant_isolation ON risk_obligation_links;

CREATE POLICY risk_obligation_links_tenant_isolation ON risk_obligation_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
