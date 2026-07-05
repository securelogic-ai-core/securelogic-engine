-- Migration: jobs_applicability_reassess
-- Package: Enterprise Context Layer (ECL) — R3 (Slice 7 live reassessment worker)
--
-- Extends the generic `jobs` table's job_type CHECK constraint with one new
-- value, 'applicability_reassess' — the durable queue entry for the S7
-- signal→platform linkage worker (applicabilityReassessmentWorker.ts).
--
-- One job = one (organization, ChangeEvent): a processed signal, a changed
-- graph edge endpoint, or a changed entity. The worker claims it (FOR UPDATE
-- SKIP LOCKED, the data-rights/vendor-extraction pattern verbatim), plans the
-- affected assessments with the pure `planReassessment` (S7 core), re-runs
-- `ApplicabilityEngineV1`, persists via the 4c writer, detects drift, and — if
-- drifted and the workflow flag is on — dispatches via the R2 dispatcher.
--
-- Same shape as 20260622_jobs_vendor_assurance_job_type.sql: ADDITIVE ONLY,
-- no data touched, every existing job_type value remains valid. Existing
-- workers filter by their own job_type ANY($) list, so this value is
-- invisible to them. Idempotent (DROP IF EXISTS + ADD).
--
-- Rollback (manual, forward-only convention): re-add the previous constraint
-- after confirming no surviving 'applicability_reassess' rows.

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
      'applicability_reassess'
    ));
