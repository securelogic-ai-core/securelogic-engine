-- 20260614_security_audit_log_immutable.sql
--
-- Makes security_audit_log append-only at the database level.
-- Application code (src/api/lib/auditLog.ts) only INSERTs, but anyone
-- with the Postgres password (engine itself, operator psql, future
-- compromised credential) could UPDATE payload or DELETE rows. There
-- is no audit-of-the-audit; an attacker scrubbing their own activity
-- from the audit log would be undetectable.
--
-- Closes OWASP audit finding A08-G1. SOC 2 CC7.2 / NIST AU-9: audit
-- records must be protected from unauthorized modification.
--
-- Two triggers:
--   1. Row-level BEFORE UPDATE OR DELETE — blocks single-row and
--      multi-row mutation attempts.
--   2. Statement-level BEFORE TRUNCATE — blocks the bulk-wipe path
--      that row-level triggers don't cover.
-- Both call the same plpgsql function, which raises an exception with
-- the attempted operation (TG_OP) in the message for operator diagnosis.
--
-- DDL (DROP TABLE, ALTER TABLE) is NOT blocked here — that would
-- require event triggers and is out of scope. The audit's "Better"
-- tier (dedicated INSERT-only DB role) is a separate T2 follow-up.
--
-- Idempotent: CREATE OR REPLACE on the function, DROP TRIGGER IF
-- EXISTS before each CREATE TRIGGER. Safe to re-run.

CREATE OR REPLACE FUNCTION security_audit_log_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'security_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_security_audit_log_row_mutation ON security_audit_log;
CREATE TRIGGER prevent_security_audit_log_row_mutation
  BEFORE UPDATE OR DELETE ON security_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION security_audit_log_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_security_audit_log_truncate ON security_audit_log;
CREATE TRIGGER prevent_security_audit_log_truncate
  BEFORE TRUNCATE ON security_audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION security_audit_log_forbid_mutation();
