-- Migration: jobs_connector_sync
-- Package: Enterprise Asset Registry — Phase 3b (connector activation)
--
-- Extends the generic `jobs` table's job_type CHECK constraint with one new
-- value, 'connector_sync' — the durable queue entry for the connector sync
-- worker (connectorSyncWorker.ts). One job = one (organization, connector)
-- sync run: fetch external inventory via the adapter, normalize, map to
-- registry asset types per adapter category, persist through the existing
-- import planner + detail-asset creator.
--
-- Same shape as 20260731_jobs_applicability_reassess.sql: ADDITIVE ONLY, no
-- data touched, every existing job_type value remains valid. Existing workers
-- filter by their own job_type ANY($) list, so this value is invisible to them.
-- Idempotent (DROP IF EXISTS + ADD).
--
-- Rollback (manual, forward-only convention): re-add the previous constraint
-- after confirming no surviving 'connector_sync' rows.

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_job_type_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_type_check
    CHECK (job_type IN (
      'data_export_self',
      'data_export_org',
      'account_deletion_reap',
      'export_file_purge',
      'vendor_assurance_extract',
      'applicability_reassess',
      'connector_sync'
    ));
