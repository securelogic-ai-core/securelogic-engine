-- Migration: applicability_worm
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 4b (persistence)
--
-- Makes the applicability decision record APPEND-ONLY at the database level (AD-16 #2),
-- using the same pattern as security_audit_log (20260614) and risk_lifecycle_events
-- (20260714, OWASP A08-G1). The decision + its by-value evidence + its blast radius
-- are the evidentiary record; they must be protected from UPDATE/DELETE/TRUNCATE by
-- anyone holding the Postgres password. INSERT remains permitted.
--
-- WHY A TRIGGER, NOT RLS: a BEFORE row/statement trigger fires REGARDLESS of the
-- connected role (owner or app_request), so immutability holds THROUGH the eventual
-- app_request/FORCE-RLS flip exactly as AD-16 requires. Inert RLS (20260726) is the
-- orthogonal tenant-isolation guarantee (scopes the permitted INSERT + SELECT); it
-- can never block an operation for all roles and the owner bypasses it. The two
-- compose: trigger = immutability, RLS = tenant scoping. The RLS migration also
-- grants app_request only SELECT, INSERT (never UPDATE/DELETE) as defense-in-depth.
--
-- One shared plpgsql function (uses TG_TABLE_NAME + TG_OP in the message) wired to
-- all three tables via:
--   1. row-level  BEFORE UPDATE OR DELETE
--   2. statement  BEFORE TRUNCATE (the bulk-wipe path row triggers miss)
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS. Safe to re-run. Runs after
-- the three table migrations (lexical: 25 > 22/23/24).

CREATE OR REPLACE FUNCTION applicability_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (WORM): % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- applicability_assessments
DROP TRIGGER IF EXISTS prevent_applicability_assessments_row_mutation ON applicability_assessments;
CREATE TRIGGER prevent_applicability_assessments_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_assessments
  FOR EACH ROW EXECUTE FUNCTION applicability_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_applicability_assessments_truncate ON applicability_assessments;
CREATE TRIGGER prevent_applicability_assessments_truncate
  BEFORE TRUNCATE ON applicability_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION applicability_forbid_mutation();

-- applicability_evidence
DROP TRIGGER IF EXISTS prevent_applicability_evidence_row_mutation ON applicability_evidence;
CREATE TRIGGER prevent_applicability_evidence_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_evidence
  FOR EACH ROW EXECUTE FUNCTION applicability_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_applicability_evidence_truncate ON applicability_evidence;
CREATE TRIGGER prevent_applicability_evidence_truncate
  BEFORE TRUNCATE ON applicability_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION applicability_forbid_mutation();

-- applicability_affected_entities
DROP TRIGGER IF EXISTS prevent_applicability_affected_entities_row_mutation ON applicability_affected_entities;
CREATE TRIGGER prevent_applicability_affected_entities_row_mutation
  BEFORE UPDATE OR DELETE ON applicability_affected_entities
  FOR EACH ROW EXECUTE FUNCTION applicability_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_applicability_affected_entities_truncate ON applicability_affected_entities;
CREATE TRIGGER prevent_applicability_affected_entities_truncate
  BEFORE TRUNCATE ON applicability_affected_entities
  FOR EACH STATEMENT EXECUTE FUNCTION applicability_forbid_mutation();
