-- Rollback for 20261017_worm_guard_consolidation.sql (E-2 Increment 1)
--
-- Restores the six per-table trigger functions and re-points every trigger at
-- them, returning the database to the pre-consolidation shape.
--
-- Because the consolidation is BEHAVIOUR-PRESERVING, this rollback is too: the
-- same operations are refused before and after, with the same messages. It
-- exists for the case where the consolidation must be undone for reasons other
-- than behaviour — a review decision, or to unblock a bisect.
--
-- Ordered so no table is ever unguarded: functions are created first, triggers
-- are re-pointed second, and the shared guard is dropped last and only if
-- nothing still references it.
--
-- NOT REVERSED: the corrected comment in lifecycleEvents.ts. The claim it
-- replaced was false; a rollback of a trigger refactor is not a reason to
-- reinstate an inaccurate statement about the cascade web.

BEGIN;

-- ---------------------------------------------------------------
-- 1. Restore the per-table functions
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION applicability_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (WORM): % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION security_audit_log_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'security_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION finding_lifecycle_events_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finding_lifecycle_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION risk_lifecycle_events_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'risk_lifecycle_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION retention_policies_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'retention_policies is append-only (versioned): % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION finding_risk_acceptances_forbid_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finding_risk_acceptances is append-only: % is forbidden. A risk acceptance is a governance artifact; withdraw it (state=''withdrawn'') instead of erasing it.', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- 2. Re-point the triggers
-- ---------------------------------------------------------------

DROP TRIGGER IF EXISTS prevent_applicability_assessments_row_mutation ON applicability_assessments;
CREATE TRIGGER prevent_applicability_assessments_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_assessments
  FOR EACH ROW EXECUTE FUNCTION applicability_forbid_mutation();
DROP TRIGGER IF EXISTS prevent_applicability_assessments_truncate ON applicability_assessments;
CREATE TRIGGER prevent_applicability_assessments_truncate
  BEFORE TRUNCATE ON applicability_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION applicability_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_applicability_evidence_row_mutation ON applicability_evidence;
CREATE TRIGGER prevent_applicability_evidence_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_evidence
  FOR EACH ROW EXECUTE FUNCTION applicability_forbid_mutation();
DROP TRIGGER IF EXISTS prevent_applicability_evidence_truncate ON applicability_evidence;
CREATE TRIGGER prevent_applicability_evidence_truncate
  BEFORE TRUNCATE ON applicability_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION applicability_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_applicability_affected_entities_row_mutation ON applicability_affected_entities;
CREATE TRIGGER prevent_applicability_affected_entities_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_affected_entities
  FOR EACH ROW EXECUTE FUNCTION applicability_forbid_mutation();
DROP TRIGGER IF EXISTS prevent_applicability_affected_entities_truncate ON applicability_affected_entities;
CREATE TRIGGER prevent_applicability_affected_entities_truncate
  BEFORE TRUNCATE ON applicability_affected_entities
  FOR EACH STATEMENT EXECUTE FUNCTION applicability_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_security_audit_log_row_mutation ON security_audit_log;
CREATE TRIGGER prevent_security_audit_log_row_mutation
  BEFORE UPDATE OR DELETE ON security_audit_log
  FOR EACH ROW EXECUTE FUNCTION security_audit_log_forbid_mutation();
DROP TRIGGER IF EXISTS prevent_security_audit_log_truncate ON security_audit_log;
CREATE TRIGGER prevent_security_audit_log_truncate
  BEFORE TRUNCATE ON security_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION security_audit_log_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_finding_lifecycle_events_row_mutation ON finding_lifecycle_events;
CREATE TRIGGER prevent_finding_lifecycle_events_row_mutation
  BEFORE UPDATE OR DELETE ON finding_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION finding_lifecycle_events_forbid_mutation();
DROP TRIGGER IF EXISTS prevent_finding_lifecycle_events_truncate ON finding_lifecycle_events;
CREATE TRIGGER prevent_finding_lifecycle_events_truncate
  BEFORE TRUNCATE ON finding_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION finding_lifecycle_events_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_risk_lifecycle_events_row_mutation ON risk_lifecycle_events;
CREATE TRIGGER prevent_risk_lifecycle_events_row_mutation
  BEFORE UPDATE OR DELETE ON risk_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION risk_lifecycle_events_forbid_mutation();
DROP TRIGGER IF EXISTS prevent_risk_lifecycle_events_truncate ON risk_lifecycle_events;
CREATE TRIGGER prevent_risk_lifecycle_events_truncate
  BEFORE TRUNCATE ON risk_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION risk_lifecycle_events_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_retention_policies_row_mutation ON retention_policies;
CREATE TRIGGER prevent_retention_policies_row_mutation
  BEFORE UPDATE OR DELETE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION retention_policies_forbid_mutation();
DROP TRIGGER IF EXISTS prevent_retention_policies_truncate ON retention_policies;
CREATE TRIGGER prevent_retention_policies_truncate
  BEFORE TRUNCATE ON retention_policies
  FOR EACH STATEMENT EXECUTE FUNCTION retention_policies_forbid_mutation();

-- legal_holds: back to ONE trigger covering UPDATE OR DELETE.
DROP TRIGGER IF EXISTS prevent_legal_holds_delete ON legal_holds;
DROP TRIGGER IF EXISTS prevent_legal_holds_truncate ON legal_holds;
DROP TRIGGER IF EXISTS guard_legal_holds_row_mutation ON legal_holds;
CREATE TRIGGER guard_legal_holds_row_mutation
  BEFORE UPDATE OR DELETE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_guard_mutation();
CREATE TRIGGER guard_legal_holds_truncate
  BEFORE TRUNCATE ON legal_holds
  FOR EACH STATEMENT EXECUTE FUNCTION legal_holds_guard_mutation();

DROP TRIGGER IF EXISTS trg_finding_risk_acceptances_forbid_delete ON finding_risk_acceptances;
CREATE TRIGGER trg_finding_risk_acceptances_forbid_delete
  BEFORE DELETE ON finding_risk_acceptances
  FOR EACH ROW EXECUTE FUNCTION finding_risk_acceptances_forbid_delete();
DROP TRIGGER IF EXISTS trg_finding_risk_acceptances_forbid_truncate ON finding_risk_acceptances;
CREATE TRIGGER trg_finding_risk_acceptances_forbid_truncate
  BEFORE TRUNCATE ON finding_risk_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION finding_risk_acceptances_forbid_delete();

-- ---------------------------------------------------------------
-- 3. Drop the shared guard, only once nothing references it
-- ---------------------------------------------------------------

DO $$
DECLARE refs BIGINT;
BEGIN
  SELECT COUNT(*) INTO refs FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND p.proname = 'worm_guard_mutation';
  IF refs > 0 THEN
    RAISE EXCEPTION 'Refusing to drop worm_guard_mutation: % trigger(s) still reference it', refs;
  END IF;
END $$;

DROP FUNCTION IF EXISTS worm_guard_mutation();

DELETE FROM schema_migrations WHERE filename = '20261017_worm_guard_consolidation.sql';

COMMIT;
