-- Migration: batch_a1_rls_policies
-- Package:   A04-G1 phase 3 — Batch A.1 (wrap-ready subset: risks + posture_snapshots)
-- Decisions: A1 (non-owner app_request role) + B1 (tx-wrapped SET LOCAL
--            app.current_org_id). See:
--              - docs/A04-G1-rls-rollout-plan.md §4 / §297 (phase 3 — Batch A)
--              - docs/A04-G1-policy-templates.md §A (CUSTOMER-DATA template)
--              - docs/A04-G1-batch-a-design.md (this PR's design pass + scope)
--              - db/migrations/20260619_findings_rls_pilot.sql (CANONICAL form —
--                the policy text below is copied verbatim from the pilot, only
--                the table name changes)
--
-- What this migration does
-- ------------------------
-- Enables RLS and installs the single canonical per-org tenant-isolation policy
-- on the two Batch-A tables whose route families are already asTenant()-wrapped
-- (risks via γ.1, posture_snapshots via γ.2). This is the PR that ACTUALLY
-- CERTIFIES DB-level RLS isolation for these two tables — the γ wrap PRs labeled
-- their cross-org tripwires "RLS certification deferred to Batch A"; this closes
-- that deferral.
--
-- Scope is risks + posture_snapshots ONLY (NOT the rollout plan's full 10-table
-- Batch A). The other 8 Batch-A tables are gated: `users` is a structural
-- pre-context-auth prerequisite needing its own design pass; vendors / controls
-- / assessments / policies / evidence / actions / reports each need their CRUD
-- route family asTenant()-wrapped first (δ' / CRUD-sweep) before a policy can
-- land without a post-flip silent-zero-rows hazard. See the design doc + memory
-- project_a04_g1_pr7_flip_reconcile (BATCH A SCOPE CORRECTION).
--
-- Both target columns are `organization_id UUID NOT NULL` already (risks:
-- 20260421_risk_register_primitives.sql:22; posture_snapshots:
-- 20260410_platform_primitives.sql) — no column-add, backfill, or NOT NULL
-- conversion is needed here, and no orphan (organization_id IS NULL) rows can
-- exist by construction.
--
-- Inert until the flip
-- --------------------
-- Under Decision A1 the policy applies only to the non-owner `app_request`
-- role. Until the operator repoints DATABASE_URL to app_request (the §4a flip,
-- still pending — and itself blocked behind the `users` pre-context-auth
-- prerequisite), every engine connection runs as the owner and BYPASSES RLS.
-- So this migration is a NO-OP in prod/staging behavior the moment it
-- auto-applies — safe to land ahead of cutover, exactly like the findings
-- pilot. Enforcement is proven independently by the SET ROLE harness tests
-- (test/isolation/risksRls.test.ts, test/isolation/postureSnapshotsRls.test.ts),
-- which connect as app_request via SET ROLE (no password needed).
--
-- NOT FORCE
-- ---------
-- Deliberately no `FORCE ROW LEVEL SECURITY` (the A2 path we did not take). The
-- owner / elevated channel (pgElevated, migrations, cross-org workers via
-- MIGRATION_DATABASE_URL) MUST keep bypassing RLS to do its legitimate
-- cross-org work. FORCE would break that.
--
-- Single FOR ALL policy
-- ---------------------
-- One policy per table covering SELECT/INSERT/UPDATE/DELETE via USING +
-- WITH CHECK. USING filters reads and the old-row check on UPDATE/DELETE;
-- WITH CHECK constrains the new-row image on INSERT/UPDATE so a tenant cannot
-- write a row stamped with another org. Both clauses use the same expression
-- (policy-templates §A, §G).
--
-- Unset-GUC safe default — why NULLIF
-- -----------------------------------
-- The GUC read is wrapped in NULLIF(…, '') before the ::uuid cast. On a POOLED
-- app_request connection a SET-then-reset GUC reads back as '' (empty string),
-- not NULL; a bare ''::uuid raises 22P02 (a 500), so NULLIF('', '') = NULL
-- collapses BOTH the truly-unset and the reset-to-empty states to NULL →
-- `organization_id = NULL` → zero rows. Fail-closed, never a 500. This is
-- load-bearing, not cosmetic. See policy-templates §I and feedback memory
-- rls_policy_nullif.
--
-- Rollback (forward-only migration; manual procedure if ever needed)
-- ------------------------------------------------------------------
--   DROP POLICY IF EXISTS risks_tenant_isolation ON risks;
--   ALTER TABLE risks DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS posture_snapshots_tenant_isolation ON posture_snapshots;
--   ALTER TABLE posture_snapshots DISABLE ROW LEVEL SECURITY;
--
-- Idempotency
-- -----------
-- ENABLE ROW LEVEL SECURITY is idempotent. CREATE POLICY is NOT — it errors if
-- the policy already exists — so each is guarded by DROP POLICY IF EXISTS,
-- making the whole file safe to re-apply.
--
-- Lock note
-- ---------
-- ENABLE ROW LEVEL SECURITY takes a brief ACCESS EXCLUSIVE lock (metadata-only,
-- no table rewrite). CREATE POLICY is metadata-only. Sub-second on these tables.

-- ── risks ──────────────────────────────────────────────────────────────────
ALTER TABLE risks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risks_tenant_isolation ON risks;

CREATE POLICY risks_tenant_isolation ON risks
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ── posture_snapshots ──────────────────────────────────────────────────────
ALTER TABLE posture_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posture_snapshots_tenant_isolation ON posture_snapshots;

CREATE POLICY posture_snapshots_tenant_isolation ON posture_snapshots
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
