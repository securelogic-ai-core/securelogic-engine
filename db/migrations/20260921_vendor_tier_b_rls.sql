-- Migration: vendor_tier_b_rls
-- Package:   Vendor Assurance — Phase 2 (Stop Gate A, Tier B)
--
-- Closes audit finding D4: `vendors`, `vendor_reviews` and all SEVEN
-- `vendor_assurance_*` tables shipped with NO row-level security. That set holds
-- the most sensitive content in the product — third-party SOC reports, their
-- extracted contents, and the vendor register itself — and isolation for it was
-- application-layer only.
--
-- ── The precondition, satisfied in Phase 0 ──────────────────────────────────
--
-- The standing A04-G1 rule is "policy => routes wrapped". This migration could
-- not land before `vendorAssuranceDocuments.ts` was tenant-scoped: it shipped 18
-- routes with zero scoping, so a policy would have created a silent zero-rows
-- failure at the app_request flip — invisible in review and in staging until
-- that flip.
--
-- Phase 0 (a3e991bd) closed that: 12 routes wrapped with asTenant, 6 scoped
-- explicitly with withTenant (they stream, redirect, do long external I/O, or
-- already open their own scope), and a structural guard
-- (vendorAssuranceTenantWrapCoverage.test.ts) that fails the build if a new
-- route arrives with neither. `vendorReviews.ts` was already fully wrapped.
-- `vendors.ts` routes are asTenant-wrapped.
--
-- ── Inert until the flip ────────────────────────────────────────────────────
--
-- Under Decision A1 these policies apply only to the non-owner app_request role.
-- Until DATABASE_URL is repointed, every engine connection runs as the owner and
-- BYPASSES RLS, so this is a no-op in production the moment it auto-applies.
-- Enforcement is proven independently by test/isolation/vendorTierBRls.test.ts
-- under SET ROLE app_request.
--
-- NOT FORCE on any table: the owner/elevated channel (pgElevated, migrations,
-- the vendor-extraction worker's claim poll, and — from Phase 3 — the portal's
-- pre-org-context token lookup) must keep bypassing RLS for legitimate work.
--
-- NULLIF(..., '') is mandatory, not stylistic: pooled app_request resets the GUC
-- to '' rather than NULL between checkouts, so a bare ''::uuid cast would raise
-- instead of isolating. With the guard the predicate is false and the caller
-- sees zero rows — fail CLOSED.
--
-- Every organization_id in this set is UUID NOT NULL, so no orphan rows exist
-- and no column-add or backfill is required.
--
-- Rollback (manual, per table):
--   DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;
--   ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- vendors — the register itself
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendors_tenant_isolation ON vendors;
CREATE POLICY vendors_tenant_isolation ON vendors
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- vendor_reviews — the mutable review-cycle workflow
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vendor_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_reviews_tenant_isolation ON vendor_reviews;
CREATE POLICY vendor_reviews_tenant_isolation ON vendor_reviews
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- vendor_assurance_* — uploaded SOC reports and everything derived from them
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vendor_assurance_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_documents_tenant_isolation ON vendor_assurance_documents;
CREATE POLICY vendor_assurance_documents_tenant_isolation ON vendor_assurance_documents
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_assurance_extractions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_extractions_tenant_isolation ON vendor_assurance_extractions;
CREATE POLICY vendor_assurance_extractions_tenant_isolation ON vendor_assurance_extractions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_assurance_extraction_spans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_extraction_spans_tenant_isolation ON vendor_assurance_extraction_spans;
CREATE POLICY vendor_assurance_extraction_spans_tenant_isolation ON vendor_assurance_extraction_spans
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_assurance_review_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_review_decisions_tenant_isolation ON vendor_assurance_review_decisions;
CREATE POLICY vendor_assurance_review_decisions_tenant_isolation ON vendor_assurance_review_decisions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_assurance_field_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_field_overrides_tenant_isolation ON vendor_assurance_field_overrides;
CREATE POLICY vendor_assurance_field_overrides_tenant_isolation ON vendor_assurance_field_overrides
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_assurance_cuecs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_cuecs_tenant_isolation ON vendor_assurance_cuecs;
CREATE POLICY vendor_assurance_cuecs_tenant_isolation ON vendor_assurance_cuecs
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_assurance_cuec_control_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_assurance_cuec_control_mappings_tenant_isolation ON vendor_assurance_cuec_control_mappings;
CREATE POLICY vendor_assurance_cuec_control_mappings_tenant_isolation ON vendor_assurance_cuec_control_mappings
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
-- Tables created after 20260621 need an explicit grant or app_request hits
-- "permission denied" — which superficially resembles isolation working, but is
-- the feature being broken for every tenant equally. `vendors` and
-- `vendor_reviews` predate that boundary and are already granted; the
-- vendor_assurance_* set does not.
--
-- Full DML: these are mutable workflow records, not WORM evidentiary ones. The
-- append-only invariants on review_decisions / field_overrides / cuec mappings
-- are enforced by their route handlers and by the absence of any UPDATE path,
-- not by withholding the grant.
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_documents             TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_extractions           TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_extraction_spans      TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_review_decisions      TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_field_overrides       TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_cuecs                 TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_assurance_cuec_control_mappings TO app_request;
