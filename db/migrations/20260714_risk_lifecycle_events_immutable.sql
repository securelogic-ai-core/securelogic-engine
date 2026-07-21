-- ============================================================
-- 20260714_risk_lifecycle_events_immutable.sql — Risk lifecycle (Epic R1)
--
-- Makes risk_lifecycle_events append-only at the database level, using the same
-- pattern as security_audit_log (20260614_security_audit_log_immutable.sql,
-- OWASP A08-G1). The lifecycle event stream is the audit record for risk
-- governance decisions; it must be protected from UPDATE/DELETE/TRUNCATE by
-- anyone with the Postgres password. INSERT remains permitted.
--
-- Two triggers call one plpgsql function that unconditionally raises:
--   1. row-level  BEFORE UPDATE OR DELETE
--   2. statement  BEFORE TRUNCATE (the bulk-wipe path row triggers miss)
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Safe to re-run.
-- Runs after 20260714_risk_lifecycle_events.sql (lexical: '.' < '_i').
-- ============================================================

CREATE OR REPLACE FUNCTION risk_lifecycle_events_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'risk_lifecycle_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_risk_lifecycle_events_row_mutation ON risk_lifecycle_events;
CREATE TRIGGER prevent_risk_lifecycle_events_row_mutation
  BEFORE UPDATE OR DELETE ON risk_lifecycle_events
  FOR EACH ROW
  EXECUTE FUNCTION risk_lifecycle_events_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_risk_lifecycle_events_truncate ON risk_lifecycle_events;
CREATE TRIGGER prevent_risk_lifecycle_events_truncate
  BEFORE TRUNCATE ON risk_lifecycle_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION risk_lifecycle_events_forbid_mutation();
