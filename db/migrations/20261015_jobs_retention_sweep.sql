-- Migration: jobs_retention_sweep
-- Package:   E-1 — Tenant Data Governance
--
-- Adds the TDG sweeper's durable job type. The sweeper is a generic
-- (organization, data_class) worker — ONE job type serves every governed class
-- now and in future, which is invariant TDG-15 expressed in the schema: adding
-- `jobs`, `data_export_files` or `email_provider_events` to the governed set
-- must not require another migration.
--
-- Safety: ADDITIVE ONLY. The list is the 20261010 list plus one value; every
-- existing row still satisfies the constraint. Other workers filter by their
-- own job_type, so this is invisible to them.

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
      'retention_sweep'
    ));
