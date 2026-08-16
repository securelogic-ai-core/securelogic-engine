-- Rollback for the E-1 Tenant Data Governance migrations
--   20261013_tenant_data_governance.sql
--   20261014_ask_ledger_survives_deletion.sql
--   20261015_jobs_retention_sweep.sql
--   20261016_ask_conversations_survive_user_deletion.sql
--
-- Written to the C-8 standard: constraints and triggers dropped BEFORE the
-- objects they guard, ordered so the script itself cannot fail halfway.
--
-- ── READ THIS BEFORE RUNNING ────────────────────────────────────────────────
--
-- A CODE rollback does not need this file. All three migrations are additive:
-- reverting the deploy leaves two empty tables, two nullable columns and one
-- unused job type behind, and every one of them is inert. That is the expected
-- rollback and it costs nothing.
--
-- This file exists for the rarer case where the SCHEMA must go back. It has one
-- genuinely one-way step, stated plainly rather than discovered at 3am:
--
--   ask_tool_invocations.message_id was widened from NOT NULL/CASCADE to
--   NULLABLE/SET NULL. Restoring NOT NULL is only possible while NO orphaned
--   ledger rows exist. Once any conversation content has been deleted — by an
--   owner, an administrator or the sweeper — orphans exist BY DESIGN, and
--   restoring NOT NULL would mean DELETING the audit records of reads performed
--   on customers' behalf, including denials. Section 2 therefore REFUSES rather
--   than deletes: it raises if orphans are present, and an operator who truly
--   intends to destroy them must do so as an explicit, separate, audited act.
--
-- Restoring ON DELETE CASCADE also re-arms the defect 20261014 fixed. Do it
-- only as part of reverting the whole package.

BEGIN;

-- ---------------------------------------------------------------
-- 1. Governance tables — triggers first, then policies, then tables
-- ---------------------------------------------------------------

DROP TRIGGER IF EXISTS guard_legal_holds_row_mutation ON legal_holds;
DROP TRIGGER IF EXISTS guard_legal_holds_truncate ON legal_holds;
DROP TRIGGER IF EXISTS prevent_retention_policies_row_mutation ON retention_policies;
DROP TRIGGER IF EXISTS prevent_retention_policies_truncate ON retention_policies;

DROP POLICY IF EXISTS legal_holds_tenant_isolation ON legal_holds;
DROP POLICY IF EXISTS retention_policies_tenant_isolation ON retention_policies;

DROP TABLE IF EXISTS legal_holds;
DROP TABLE IF EXISTS retention_policies;

DROP FUNCTION IF EXISTS legal_holds_guard_mutation();
DROP FUNCTION IF EXISTS retention_policies_forbid_mutation();

-- The audit events themselves are NOT removed. security_audit_log is
-- append-only by design and its rows are the record that governance actions
-- occurred; a schema rollback does not un-happen them.

-- ---------------------------------------------------------------
-- 2. The Ask ledger — refuses rather than destroys
-- ---------------------------------------------------------------

DO $$
DECLARE orphans BIGINT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM ask_tool_invocations WHERE message_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'Refusing to restore NOT NULL on ask_tool_invocations.message_id: % orphaned ledger row(s) exist. '
      'These are audit records of reads whose content has already been deleted. Destroying them is a '
      'separate, deliberate act — not a side effect of a schema rollback.', orphans;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_ask_tool_invocations_orphaned;
DROP INDEX IF EXISTS idx_ask_tool_invocations_conversation;

ALTER TABLE ask_tool_invocations
  DROP CONSTRAINT IF EXISTS ask_tool_invocations_message_id_fkey;

ALTER TABLE ask_tool_invocations
  ADD CONSTRAINT ask_tool_invocations_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES ask_messages(id) ON DELETE CASCADE;

ALTER TABLE ask_tool_invocations ALTER COLUMN message_id SET NOT NULL;
ALTER TABLE ask_tool_invocations DROP COLUMN IF EXISTS conversation_id;

-- ---------------------------------------------------------------
-- 3. jobs.job_type — back to the 20261010 list
-- ---------------------------------------------------------------
--
-- Refuses if any retention_sweep row exists, for the same reason as above: the
-- constraint would be violated, and silently deleting job history to make a
-- constraint fit is how audit trails disappear.

DO $$
DECLARE sweeps BIGINT;
BEGIN
  SELECT COUNT(*) INTO sweeps FROM jobs WHERE job_type = 'retention_sweep';
  IF sweeps > 0 THEN
    RAISE EXCEPTION
      'Refusing to narrow jobs_job_type_check: % retention_sweep job row(s) exist.', sweeps;
  END IF;
END $$;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
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
      'ask_provenance'
    ));

-- ---------------------------------------------------------------
-- 4. The conversation owner FK — DELIBERATELY NOT REVERTED
-- ---------------------------------------------------------------
--
-- 20261016 replaced ON DELETE CASCADE with ON DELETE SET NULL so that deleting
-- a user could not destroy the organization's Ask conversations. Restoring the
-- CASCADE would re-arm exactly the behaviour the operator ruling of 2026-08-16
-- forbids, and it would do so silently: no error, no audit row, an entire
-- thread history gone the next time a user record is hard-deleted.
--
-- This is a rollback script, not a licence to reintroduce a data-loss path. The
-- SET NULL stays. Reverting it is a separate, deliberate act that needs its own
-- ruling, and `ask_messages.user_id` has been SET NULL since 20260922 anyway,
-- so the CASCADE was already the odd one out.

-- ---------------------------------------------------------------
-- 5. Bookkeeping
-- ---------------------------------------------------------------

DELETE FROM schema_migrations
 WHERE filename IN (
   '20261013_tenant_data_governance.sql',
   '20261014_ask_ledger_survives_deletion.sql',
   '20261015_jobs_retention_sweep.sql'
   -- 20261016 is NOT unstamped: its change is retained (section 4).
 );

COMMIT;
