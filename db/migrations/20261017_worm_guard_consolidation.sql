-- Migration: worm_guard_consolidation
-- Package:   E-2 Increment 1 — one WORM policy, not nine copies
--
-- BEHAVIOUR-PRESERVING. Every refusal this database makes today it still makes
-- after this migration, with a byte-identical message. Nothing is permitted that
-- was previously refused, and nothing is refused that was previously permitted.
-- That is the whole contract of this increment; the equivalence matrix in
-- test/isolation/wormGuardConsolidation.test.ts is what proves it.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- Nine tables enforce append-only semantics through SIX independently-written
-- trigger functions. Each new evidentiary table has arrived with its own copy —
-- E-1 added two of them. There is no single WORM policy; there are six, and
-- they have already drifted in wording, in which operations they cover, and in
-- whether they guard TRUNCATE.
--
-- That matters beyond tidiness. E-2 must eventually let ONE certified erasure
-- transaction through these guards. Six implementations means that exception
-- has to be written six times and stay in step forever; the copy that is missed
-- is the table that quietly stops being protected, or the table that quietly
-- cannot be erased. One implementation makes the later change a single, small,
-- reviewable diff.
--
-- ── THE SPLIT, and why it is drawn here ─────────────────────────────────────
--
-- DELETE and TRUNCATE are a POLICY: "this row may never be removed." That is
-- identical on all nine tables and moves to the shared guard.
--
-- UPDATE is sometimes a policy and sometimes DOMAIN LOGIC:
--   * append-only tables: "no UPDATE at all" — a policy, so it moves.
--   * legal_holds: "only active -> released, and the release may not alter the
--     hold" — a state machine.
--   * finding_risk_acceptances: an immutable subject plus legal transitions —
--     a state machine.
-- The two state machines STAY in their own functions. Folding domain rules into
-- a shared guard would make the shared thing table-aware, which is the failure
-- it exists to prevent.
--
-- Result: every DELETE/TRUNCATE refusal in the database — the erasure-relevant
-- surface — is in ONE function, and the UPDATE refusals that are pure policy
-- are there too.
--
-- ── A CORRECTION THIS MIGRATION CARRIES ─────────────────────────────────────
--
-- 20261013 (E-1) states in a comment that its SET NULL actor columns keep
-- retention_policies and legal_holds OUT of the D-12 cascade web. That is
-- wrong, and it is recorded here rather than by editing an applied migration.
--
--   * A SET NULL cascade is an UPDATE, and these guards cover UPDATE OR DELETE,
--     so SET NULL does not avoid the web at all.
--   * organization_id on both tables is ON DELETE CASCADE regardless.
--
-- Verified against a real database: an organization holding ONLY a
-- retention_policies row, or ONLY a legal_holds row, cannot be deleted. Both
-- tables are among the nine blockers. No production defect follows from this
-- today — no shipped code deletes an organization or a user — but the claim was
-- false, and lifecycleEvents.ts is corrected in the same change.
--
-- ── WHAT IS NOT IN THIS MIGRATION ───────────────────────────────────────────
--
-- No escape hatch. No erasure role. No certificate. The guard gains no ability
-- to permit anything. E-2 Increment 2 adds the guarded exception; this
-- migration only makes there be one place to add it.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS throughout.

-- ---------------------------------------------------------------
-- The shared guard
-- ---------------------------------------------------------------
--
-- Arguments let each table keep its exact operator-facing wording, because
-- those messages are read during incidents and two of them carry guidance:
--   TG_ARGV[0]  descriptor  e.g. 'append-only (versioned)'
--   TG_ARGV[1]  verb        default 'is not permitted'
--   TG_ARGV[2]  suffix      default '' (appended verbatim)
--
-- The message is assembled and raised via USING MESSAGE rather than a format
-- string, so a table's descriptor can never be interpreted as a format spec.

CREATE OR REPLACE FUNCTION worm_guard_mutation()
RETURNS trigger AS $$
DECLARE
  descriptor TEXT := COALESCE(TG_ARGV[0], 'append-only');
  verb       TEXT := COALESCE(TG_ARGV[1], 'is not permitted');
  suffix     TEXT := COALESCE(TG_ARGV[2], '');
  msg        TEXT;
BEGIN
  msg := TG_TABLE_NAME || ' is ' || descriptor || ': ' || TG_OP || ' ' || verb || suffix;
  RAISE EXCEPTION USING MESSAGE = msg;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION worm_guard_mutation() IS
  'The single WORM policy. Refuses the operation unconditionally and is wired to '
  'every append-only table. E-2 Increment 2 adds the certified-erasure exception '
  'HERE and nowhere else — if a table has its own copy of this logic, that is a '
  'defect, and wormGuardConsolidation.test.ts fails the build for it.';

-- ---------------------------------------------------------------
-- 1. Fully append-only tables — UPDATE, DELETE and TRUNCATE all refused
-- ---------------------------------------------------------------

-- applicability_assessments / _evidence / _affected_entities (20260725)
DROP TRIGGER IF EXISTS prevent_applicability_assessments_row_mutation ON applicability_assessments;
CREATE TRIGGER prevent_applicability_assessments_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_assessments
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (WORM)');
DROP TRIGGER IF EXISTS prevent_applicability_assessments_truncate ON applicability_assessments;
CREATE TRIGGER prevent_applicability_assessments_truncate
  BEFORE TRUNCATE ON applicability_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (WORM)');

DROP TRIGGER IF EXISTS prevent_applicability_evidence_row_mutation ON applicability_evidence;
CREATE TRIGGER prevent_applicability_evidence_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_evidence
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (WORM)');
DROP TRIGGER IF EXISTS prevent_applicability_evidence_truncate ON applicability_evidence;
CREATE TRIGGER prevent_applicability_evidence_truncate
  BEFORE TRUNCATE ON applicability_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (WORM)');

DROP TRIGGER IF EXISTS prevent_applicability_affected_entities_row_mutation ON applicability_affected_entities;
CREATE TRIGGER prevent_applicability_affected_entities_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_affected_entities
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (WORM)');
DROP TRIGGER IF EXISTS prevent_applicability_affected_entities_truncate ON applicability_affected_entities;
CREATE TRIGGER prevent_applicability_affected_entities_truncate
  BEFORE TRUNCATE ON applicability_affected_entities
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (WORM)');

-- security_audit_log (20260614)
DROP TRIGGER IF EXISTS prevent_security_audit_log_row_mutation ON security_audit_log;
CREATE TRIGGER prevent_security_audit_log_row_mutation
  BEFORE UPDATE OR DELETE ON security_audit_log
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only');
DROP TRIGGER IF EXISTS prevent_security_audit_log_truncate ON security_audit_log;
CREATE TRIGGER prevent_security_audit_log_truncate
  BEFORE TRUNCATE ON security_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only');

-- finding_lifecycle_events (20260714)
DROP TRIGGER IF EXISTS prevent_finding_lifecycle_events_row_mutation ON finding_lifecycle_events;
CREATE TRIGGER prevent_finding_lifecycle_events_row_mutation
  BEFORE UPDATE OR DELETE ON finding_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only');
DROP TRIGGER IF EXISTS prevent_finding_lifecycle_events_truncate ON finding_lifecycle_events;
CREATE TRIGGER prevent_finding_lifecycle_events_truncate
  BEFORE TRUNCATE ON finding_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only');

-- risk_lifecycle_events (20260714)
DROP TRIGGER IF EXISTS prevent_risk_lifecycle_events_row_mutation ON risk_lifecycle_events;
CREATE TRIGGER prevent_risk_lifecycle_events_row_mutation
  BEFORE UPDATE OR DELETE ON risk_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only');
DROP TRIGGER IF EXISTS prevent_risk_lifecycle_events_truncate ON risk_lifecycle_events;
CREATE TRIGGER prevent_risk_lifecycle_events_truncate
  BEFORE TRUNCATE ON risk_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only');

-- retention_policies (20261013, E-1)
DROP TRIGGER IF EXISTS prevent_retention_policies_row_mutation ON retention_policies;
CREATE TRIGGER prevent_retention_policies_row_mutation
  BEFORE UPDATE OR DELETE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (versioned)');
DROP TRIGGER IF EXISTS prevent_retention_policies_truncate ON retention_policies;
CREATE TRIGGER prevent_retention_policies_truncate
  BEFORE TRUNCATE ON retention_policies
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (versioned)');

-- ---------------------------------------------------------------
-- 2. Tables whose UPDATE is a state machine — DELETE/TRUNCATE only
-- ---------------------------------------------------------------

-- legal_holds (20261013, E-1). The active -> released transition and the
-- "a release may not alter the hold" rule stay in legal_holds_guard_mutation,
-- which is now wired to UPDATE alone. Its DELETE branch becomes unreachable and
-- is left in place deliberately: if this trigger is ever re-pointed at DELETE
-- by mistake, it still refuses rather than falling through.
DROP TRIGGER IF EXISTS guard_legal_holds_row_mutation ON legal_holds;
CREATE TRIGGER guard_legal_holds_row_mutation
  BEFORE UPDATE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_guard_mutation();

DROP TRIGGER IF EXISTS prevent_legal_holds_delete ON legal_holds;
CREATE TRIGGER prevent_legal_holds_delete
  BEFORE DELETE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-plus-release');

DROP TRIGGER IF EXISTS guard_legal_holds_truncate ON legal_holds;
DROP TRIGGER IF EXISTS prevent_legal_holds_truncate ON legal_holds;
CREATE TRIGGER prevent_legal_holds_truncate
  BEFORE TRUNCATE ON legal_holds
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-plus-release');

-- finding_risk_acceptances (20260907). Its UPDATE state machine
-- (finding_risk_acceptances_enforce_worm) is untouched. The delete guidance is
-- preserved verbatim, including the verb, because it is read during incidents.
DROP TRIGGER IF EXISTS trg_finding_risk_acceptances_forbid_delete ON finding_risk_acceptances;
CREATE TRIGGER trg_finding_risk_acceptances_forbid_delete
  BEFORE DELETE ON finding_risk_acceptances
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation(
    'append-only',
    'is forbidden.',
    ' A risk acceptance is a governance artifact; withdraw it (state=''withdrawn'') instead of erasing it.');

DROP TRIGGER IF EXISTS trg_finding_risk_acceptances_forbid_truncate ON finding_risk_acceptances;
CREATE TRIGGER trg_finding_risk_acceptances_forbid_truncate
  BEFORE TRUNCATE ON finding_risk_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation(
    'append-only',
    'is forbidden.',
    ' A risk acceptance is a governance artifact; withdraw it (state=''withdrawn'') instead of erasing it.');

-- ---------------------------------------------------------------
-- 3. Retire the superseded functions
-- ---------------------------------------------------------------
--
-- Dropped only after every trigger above has been re-pointed, so there is no
-- window in which a table is unguarded. legal_holds_guard_mutation and
-- finding_risk_acceptances_enforce_worm are NOT dropped — they still carry the
-- two state machines.

DROP FUNCTION IF EXISTS applicability_forbid_mutation();
DROP FUNCTION IF EXISTS security_audit_log_forbid_mutation();
DROP FUNCTION IF EXISTS finding_lifecycle_events_forbid_mutation();
DROP FUNCTION IF EXISTS risk_lifecycle_events_forbid_mutation();
DROP FUNCTION IF EXISTS retention_policies_forbid_mutation();
DROP FUNCTION IF EXISTS finding_risk_acceptances_forbid_delete();
