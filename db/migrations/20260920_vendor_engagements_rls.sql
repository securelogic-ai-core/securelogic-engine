-- Migration: vendor_engagements_rls
-- Package:   Vendor Assurance — Phase 2 (Stop Gate A, first table)
--
-- Enables the canonical per-org tenant-isolation policy on vendor_engagements.
--
-- ── Why this is safe to land WITH the table ─────────────────────────────────
--
-- The standing A04-G1 rule is "policy => routes wrapped": a policy on a table
-- whose routes are not tenant-scoped is a latent zero-rows hazard that only
-- appears at the app_request flip. vendor_engagements has NO routes yet — it is
-- born empty and unrouted — so the invariant holds trivially, and every route
-- added later inherits an already-enforcing table rather than needing a
-- retrofit. This is the opposite of the vendor_assurance_* situation, where 18
-- unscoped routes had to be wrapped in Phase 0 before RLS could be considered.
--
-- ── Inert until the flip ────────────────────────────────────────────────────
--
-- Under Decision A1 the policy applies only to the non-owner app_request role.
-- Until DATABASE_URL is repointed to app_request, every engine connection runs
-- as the owner and BYPASSES RLS — so this is a no-op in production the moment it
-- auto-applies. Enforcement is proven independently by
-- test/isolation/vendorEngagementsRls.test.ts, which does SET ROLE app_request.
--
-- NOT FORCE: the owner/elevated channel (pgElevated, migrations, the portal's
-- pre-org-context token lookup) must keep bypassing RLS for legitimate work.
--
-- NULLIF(..., '') makes a reset/unset GUC fail CLOSED (zero rows) rather than
-- throwing on ''::uuid — pooled app_request resets the GUC to '' between
-- checkouts, so a bare cast would 500 instead of isolating.
--
-- organization_id is UUID NOT NULL on this table, so no orphan (NULL-org) rows
-- can exist and no column-add or backfill is needed.
--
-- Rollback (manual):
--   DROP POLICY IF EXISTS vendor_engagements_tenant_isolation ON vendor_engagements;
--   ALTER TABLE vendor_engagements DISABLE ROW LEVEL SECURITY;

ALTER TABLE vendor_engagements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_engagements_tenant_isolation ON vendor_engagements;

CREATE POLICY vendor_engagements_tenant_isolation ON vendor_engagements
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
