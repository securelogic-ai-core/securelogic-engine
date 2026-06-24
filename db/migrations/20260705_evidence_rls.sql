-- 20260705_evidence_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on evidence.
-- 22nd RLS table.
--
-- Safe to enable now: every reader and writer of `evidence` is tenant-safe at
-- the owner->app_request DATABASE_URL flip, and every access already carries an
-- explicit organization_id predicate:
--   - evidence.ts (the only writer — INSERT; plus GET list / GET :id reads) is
--     asTenant()-wrapped, so the INSERT runs under the app.current_org_id GUC
--     and satisfies RLS WITH CHECK.
--   - dashboard.ts (evidence-count read) runs inside the asTenant() route wrap
--     and filters WHERE organization_id = $1.
--   - auditPackage.ts (control-test evidence read) runs inside
--     withTenant(organizationId, () => assembleAuditPackage(...)) and filters
--     AND e.organization_id = $2.
-- No UPDATE/DELETE of evidence exists in application code (rows are removed only
-- via the organizations FK ON DELETE CASCADE, an owner-channel operation).
-- Preserves the "policy => readers+writers tenant-safe" invariant.
--
-- organization_id is NOT NULL. NOT FORCE — owner bypasses; INERT until the flip.

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evidence_tenant_isolation ON evidence;

CREATE POLICY evidence_tenant_isolation ON evidence
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
