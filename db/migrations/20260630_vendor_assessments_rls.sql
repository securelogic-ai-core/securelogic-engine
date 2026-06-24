-- Migration: vendor_assessments_rls
-- Package: A04-G1 phase 3 — RLS policy on vendor_assessments (Batch C workflow table).
--
-- Enables the canonical per-org tenant-isolation policy on vendor_assessments.
-- Safe to land because this table's route family is FULLY asTenant()-wrapped
-- (the γ.3 wrap — vendorAssessments.ts: all 3 routes use asTenant(), and the
-- post-commit recompute opens its OWN withTenant(orgId)), so the
-- "policy ⟹ routes wrapped" invariant holds and the future DATABASE_URL flip
-- cannot cause a silent zero-rows hazard on this table.
--
-- organization_id is UUID NOT NULL (20260413_vendor_assessment_workflow.sql) — no
-- orphan (NULL-org) rows can exist; no column-add/backfill needed.
--
-- INERT until the flip: under Decision A1 the policy applies only to the
-- non-owner app_request role. Until DATABASE_URL is repointed to app_request,
-- every engine connection runs as the owner and BYPASSES RLS — a no-op in prod
-- the moment it auto-applies, exactly like the Batch A.1 migration. Enforcement
-- is proven independently by test/isolation/vendorAssessmentsRls.test.ts
-- (SET ROLE app_request, no password).
--
-- NOT FORCE: the owner/elevated channel (pgElevated, migrations) must keep
-- bypassing RLS for legitimate cross-org work. NULLIF(…, '') makes a reset/unset
-- GUC fail CLOSED (zero rows), never a 500 on ''::uuid (rls_policy_nullif).
--
-- Rollback (manual): DROP POLICY IF EXISTS vendor_assessments_tenant_isolation ON
-- vendor_assessments; ALTER TABLE vendor_assessments DISABLE ROW LEVEL SECURITY;

ALTER TABLE vendor_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_assessments_tenant_isolation ON vendor_assessments;

CREATE POLICY vendor_assessments_tenant_isolation ON vendor_assessments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
