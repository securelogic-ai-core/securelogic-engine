-- Migration: findings_rls_pilot
-- Package:   A04-G1 phase 2 — Postgres RLS rollout (PILOT TABLE)
-- Decisions: A1 (non-owner app_request role) + B1 (tx-wrapped SET LOCAL
--            app.current_org_id). See:
--              - docs/A04-G1-rls-rollout-plan.md §4 (phase 2 — pilot: findings)
--              - docs/A04-G1-policy-templates.md §A (CUSTOMER-DATA template)
--
-- What this migration does
-- ------------------------
-- Enables RLS on `findings` (the phase-2 pilot table) and installs the single
-- canonical per-org tenant-isolation policy. `findings` is the pilot because:
--   * it has a clean `organization_id NOT NULL` column (added + backfilled +
--     SET NOT NULL in 20260410_platform_primitives.sql:24,51 — note this
--     CORRECTS docs/A04-G1-table-classification.md, which previously listed
--     findings as INDIRECT/no-org-column; the schema is authoritative);
--   * it is exercised by the E1-G1 cross-org isolation harness (GET/PATCH);
--   * it is wide-touched, so a regression is loud, not silent.
--
-- Inert until the flip
-- --------------------
-- Under Decision A1 the policy applies only to the non-owner `app_request`
-- role. Until the operator repoints DATABASE_URL to app_request (the §4a flip,
-- still pending — MIGRATION_DATABASE_URL unset, app_request has no password),
-- every engine connection runs as the owner and BYPASSES RLS. So this
-- migration is a NO-OP in prod/staging behavior the moment it auto-applies —
-- safe to land ahead of cutover, exactly like 20260618_create_app_request_role.
-- Enforcement is proven independently by test/isolation/findingsRls.test.ts,
-- which connects as app_request via SET ROLE (no password needed).
--
-- NOT FORCE
-- ---------
-- Deliberately no `FORCE ROW LEVEL SECURITY` (that is the A2 path we did not
-- take). The owner / elevated channel (pgElevated, migrations, cross-org
-- workers via MIGRATION_DATABASE_URL) MUST keep bypassing RLS to do its
-- legitimate cross-org work. FORCE would break that.
--
-- Single FOR ALL policy
-- ---------------------
-- One policy covering SELECT/INSERT/UPDATE/DELETE via USING + WITH CHECK,
-- rather than four per-command policies. USING filters reads and the
-- old-row check on UPDATE/DELETE; WITH CHECK constrains the new-row image on
-- INSERT/UPDATE so a tenant cannot write a row stamped with another org.
-- Both clauses use the same expression (policy-templates §A, §G).
--
-- Unset-GUC safe default — why NULLIF
-- -----------------------------------
-- The GUC read is wrapped in NULLIF(…, '') before the ::uuid cast. This is
-- load-bearing, not cosmetic: a custom GUC that has been SET on a connection
-- and then reset (which is what happens on a POOLED app_request connection
-- between requests) reads back as an EMPTY STRING, not NULL —
-- current_setting('app.current_org_id', true) returns '' in that state. A bare
-- ''::uuid raises 22P02, so the naive template would make a forgotten
-- withTenant a 500 instead of a graceful empty result. NULLIF('', '') = NULL,
-- and NULLIF(NULL, '') = NULL, so BOTH the truly-unset and the reset-to-empty
-- states collapse to NULL → `organization_id = NULL` → no rows. Fail-closed to
-- ZERO ROWS in every unscoped state — which is exactly what rollout-plan §5
-- requires ("unset → assert zero rows"). Verified by the pilot test (a pooled
-- connection reproduces the empty-string state). See policy-templates §I.
--
-- Rollback (forward-only migration; manual procedure if ever needed)
-- ------------------------------------------------------------------
--   DROP POLICY IF EXISTS findings_tenant_isolation ON findings;
--   ALTER TABLE findings DISABLE ROW LEVEL SECURITY;
--
-- Idempotency
-- -----------
-- ENABLE ROW LEVEL SECURITY is idempotent. CREATE POLICY is NOT — it errors
-- if the policy already exists — so it is guarded by DROP POLICY IF EXISTS,
-- making the whole file safe to re-apply.

ALTER TABLE findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS findings_tenant_isolation ON findings;

CREATE POLICY findings_tenant_isolation ON findings
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
