-- Migration: jobs_vendor_assurance_job_type
-- Package:   Pillar 1 — Vendor-Assurance Durable Extraction Worker (build step 1 of §E)
-- Spec:      docs/roadmap/pillar1-vendor-assurance-worker-spec.md (§B.1, §F.2, §E step 1)
--
-- Extends the generic `jobs` table's job_type CHECK constraint with one new
-- value, 'vendor_assurance_extract', so the durable vendor-extraction worker
-- can enqueue/claim SOC-extraction work on the SAME generic queue the
-- data-rights worker already uses. Settled decision §F.2: REUSE the generic
-- `jobs` table — no new queue table. The data-rights worker ignores the new
-- type via its own job_type ANY($2) filter, so this change is invisible to it.
--
-- The `jobs` table and its job_type CHECK were created in
-- 20260621_gdpr_foundations.sql:120-124 as an INLINE column CHECK:
--     job_type TEXT NOT NULL CHECK (job_type IN (
--       'data_export_self','data_export_org',
--       'account_deletion_reap','export_file_purge'))
-- An inline column CHECK on `job_type` in table `jobs` is auto-named
-- `jobs_job_type_check` by Postgres. This migration drops and recreates that
-- constraint under the SAME name with the original four values PLUS the new
-- one, mirroring the established CHECK-extension idiom in this repo
-- (20260510_cyber_signals_signal_type_extended.sql,
--  20260514_brief_sends_suppressed_status.sql).
--
-- Safety: ADDITIVE ONLY. No data is touched. Every existing job_type value
-- ('data_export_self','data_export_org','account_deletion_reap',
-- 'export_file_purge') remains valid, so the recreated constraint validates
-- against all existing rows without rewriting them; the only behavioral change
-- is that one additional value is now permitted. No new column, table, index,
-- grant, or RLS change — `jobs` already ENABLEs RLS and is granted to
-- app_request (20260621_gdpr_foundations.sql §D); a CHECK extension needs none
-- of that.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before ADD, so the migration is safe to
-- re-run. Forward-running filename (20260622, latest prior is 20260621). Applies
-- automatically on Render deploy via the engine startCommand (npm run migrate).

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_job_type_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_type_check
    CHECK (job_type IN (
      'data_export_self',
      'data_export_org',
      'account_deletion_reap',
      'export_file_purge',
      'vendor_assurance_extract'
    ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (forward-only migration; manual procedure if ever needed)
-- ─────────────────────────────────────────────────────────────────────────────
-- Reverting requires that no surviving row uses the new value (otherwise the
-- narrower constraint fails validation). With vendor-extraction jobs absent or
-- removed first:
--   ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
--   ALTER TABLE jobs
--     ADD CONSTRAINT jobs_job_type_check
--       CHECK (job_type IN (
--         'data_export_self','data_export_org',
--         'account_deletion_reap','export_file_purge'));
