-- Migration: jobs_control_matcher_suggest
-- Package: async LLM control matcher (Candidate A — take suggestion generation
--          off the Intelligence Brief publication critical path)
--
-- Extends the generic `jobs` table's job_type CHECK constraint with one new
-- value, 'control_matcher_suggest' — the durable queue entry for the
-- controlMatcherWorker.
--
-- WHY THIS EXISTS
-- ---------------
-- The LLM control matcher ran INLINE inside processSignal (phase 7), so the
-- weekly Brief scheduler awaited one provider call per Critical/High signal per
-- org, strictly sequentially. Measured on staging 2026-08-18: the slowest org
-- spent 87.6% of its 3.15-hour runtime in those calls, producing
-- `signal_match_suggestions` rows that Brief generation never reads. This job
-- type moves the WHEN and WHERE of that work; the suggestion semantics are
-- unchanged.
--
-- One job = one (organization, signal). The worker claims it with
-- FOR UPDATE SKIP LOCKED (the data-rights / vendor-extraction / applicability-
-- reassess pattern verbatim), so a redeploy mid-job is reclaimed via the lock
-- timeout rather than losing the suggestion.
--
-- Same shape as 20261015_jobs_retention_sweep.sql: ADDITIVE ONLY, no data
-- touched, every existing job_type value remains valid. Existing workers filter
-- by their own job_type, so this value is invisible to them. Idempotent
-- (DROP IF EXISTS + ADD).
--
-- Rollback (manual, forward-only convention): re-add the previous constraint
-- after confirming no surviving 'control_matcher_suggest' rows.

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
      'connector_sync',
      'vendor_evidence_analysis',
      'ask_provenance',
      'retention_sweep',
      'control_matcher_suggest'
    ));
