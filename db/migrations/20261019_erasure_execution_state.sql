-- Migration: erasure_execution_state
-- Package:   E-2 Increment 3 — durable execution state and scope binding
--
-- Increment 2 built the mechanism; this adds what an EXECUTOR needs to be safe
-- across time. Each column exists to close one specific way an erasure can go
-- wrong between the moment it is approved and the moment it destroys anything.
--
--   scope_fingerprint     Approval is granted for an INVENTORY, not for a name.
--                         The fingerprint is a digest of that inventory (table
--                         -> row count) taken at approval. Immediately before
--                         destruction the executor re-inventories and compares:
--                         if the tenant has materially changed, the approval no
--                         longer describes what would be destroyed, and the run
--                         refuses. Approving "erase 412 rows" must not silently
--                         authorize erasing 40,000.
--
--   approval_expires_at   A stale approval is not an approval. Without an
--                         expiry, a decision made once could be executed years
--                         later against a tenant nobody re-examined.
--
--   attempt_count         Committed BEFORE the destructive transaction opens,
--                         so a process that dies mid-run leaves a trace. Without
--                         it an interrupted erasure is indistinguishable from
--                         one that never started.
--   last_attempt_at
--   failure_reason        Why the last attempt failed, for diagnosis.
--
--   inventory_snapshot    The counts the fingerprint was computed from, kept so
--                         a later reviewer can see WHAT was approved rather than
--                         only a hash of it. Counts and table names only — the
--                         same discipline as scope_digest, never content.
--
-- Safety: ADDITIVE. Six nullable columns on a table that is empty in every
-- environment. No data changes, no behaviour changes to anything already live.

ALTER TABLE erasure_certificates
  ADD COLUMN IF NOT EXISTS scope_fingerprint   TEXT        NULL,
  ADD COLUMN IF NOT EXISTS inventory_snapshot  JSONB       NULL,
  ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS attempt_count       INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failure_reason      TEXT        NULL;

-- An approved certificate must carry the scope it was approved for and a
-- deadline. Enforced in the database so an executor cannot be handed an
-- approval that never bound anything.
ALTER TABLE erasure_certificates
  DROP CONSTRAINT IF EXISTS erasure_certificates_approved_scope;

ALTER TABLE erasure_certificates
  ADD CONSTRAINT erasure_certificates_approved_scope CHECK (
    status = 'draft'
    OR (scope_fingerprint IS NOT NULL AND approval_expires_at IS NOT NULL)
  );

COMMENT ON COLUMN erasure_certificates.scope_fingerprint IS
  'Digest of the inventory this approval was granted for. Re-computed immediately '
  'before destruction; a mismatch refuses the run.';
COMMENT ON COLUMN erasure_certificates.approval_expires_at IS
  'After this instant the approval is void and must be sought again.';
COMMENT ON COLUMN erasure_certificates.attempt_count IS
  'Committed before the destructive transaction opens, so an interrupted run is '
  'diagnosable rather than invisible.';

-- The certificate guard already freezes the subject; the new columns advance
-- with the lifecycle, so no change to erasure_certificates_guard() is needed.

-- ---------------------------------------------------------------
-- The one privilege the executor was missing
-- ---------------------------------------------------------------
--
-- The executor writes its audit events on the SAME connection and inside the
-- SAME transaction as the destruction, so the erasure and its record cannot
-- diverge. That requires INSERT on security_audit_log, which Increment 2
-- deliberately did not grant.
--
-- INSERT ONLY, and it does not weaken the "can destroy, cannot read" property:
-- without SELECT the role still cannot read a single audit row, and the WORM
-- guard still refuses every UPDATE and DELETE it might attempt. It can append
-- to the record of what it did; it cannot read or rewrite that record.

GRANT INSERT ON security_audit_log TO erasure_agent;

-- ---------------------------------------------------------------
-- erasure_inventory() — counts without readership
-- ---------------------------------------------------------------
--
-- THE PROBLEM THIS SOLVES. The executor must re-take the inventory at the
-- moment of destruction (that is the whole TOCTOU property), and it runs as
-- erasure_agent. Counting rows in 115 org-scoped tables would require SELECT on
-- all of them — which would turn the erasure credential into a full
-- data-read credential, destroying the property Increment 2 established that a
-- stolen erasure credential can destroy a tenant but cannot read one.
--
-- So the counting happens inside a SECURITY DEFINER function owned by the
-- table owner. erasure_agent may EXECUTE it and receives AGGREGATE COUNTS only:
-- it can learn that a tenant has 412 rows in ask_messages, and it cannot read
-- one of them. The function returns no column from any tenant table.
--
-- Hardening: search_path is pinned so the definer's rights cannot be redirected
-- to an attacker-controlled schema, table names come from information_schema
-- and are quoted, and the organization id is a bound parameter throughout.

CREATE OR REPLACE FUNCTION erasure_inventory(target_org UUID)
RETURNS TABLE (table_name TEXT, row_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t TEXT;
  n BIGINT;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'organization_id'
       AND tb.table_type = 'BASE TABLE'
     ORDER BY c.table_name
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE organization_id = $1', t)
      INTO n USING target_org;
    IF n > 0 THEN
      table_name := t;
      row_count := n;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION erasure_inventory(UUID) IS
  'Row counts per org-scoped table for one organization. SECURITY DEFINER so '
  'the erasure role can measure a tenant without holding SELECT on tenant '
  'tables — it returns counts, never rows.';

-- The count of tables SCANNED (not just those with rows), for the report.
CREATE OR REPLACE FUNCTION erasure_scanned_table_count()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::bigint
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
   WHERE c.table_schema = 'public'
     AND c.column_name = 'organization_id'
     AND tb.table_type = 'BASE TABLE';
$$;

-- Not granted to app_request: the application has no business enumerating a
-- tenant's shape this way.
GRANT EXECUTE ON FUNCTION erasure_inventory(UUID) TO erasure_agent;
GRANT EXECUTE ON FUNCTION erasure_scanned_table_count() TO erasure_agent;

-- ---------------------------------------------------------------
-- The certificate guard: one narrowly-permitted change to dry_run
-- ---------------------------------------------------------------
--
-- Increment 2 froze dry_run as part of the immutable subject. Increment 3 shows
-- that was one notch too tight, for a reason worth stating rather than quietly
-- relaxing: the SECOND PERSON should be the one who decides whether a
-- certificate is a rehearsal or a destruction.
--
-- If dry_run were fixed at request time, the requester would choose
-- destructiveness and the approver would only ratify a decision already made —
-- which weakens exactly the control the two-person rule exists to provide.
--
-- So precisely one transition is permitted: TRUE -> FALSE, and only on the
-- draft -> approved edge. It can never be re-armed, never flipped after
-- approval, and never set the other way. Everything else about the subject
-- stays frozen.

CREATE OR REPLACE FUNCTION erasure_certificates_guard()
RETURNS trigger AS $$
DECLARE
  clearing_dry_run BOOLEAN;
BEGIN
  clearing_dry_run :=
        OLD.dry_run IS TRUE
    AND NEW.dry_run IS FALSE
    AND OLD.status = 'draft'
    AND NEW.status = 'approved';

  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.requested_by_user_id <> OLD.requested_by_user_id
     OR NEW.reason <> OLD.reason
     OR NEW.legal_basis <> OLD.legal_basis
     OR NEW.requested_at <> OLD.requested_at
     OR (NEW.dry_run IS DISTINCT FROM OLD.dry_run AND NOT clearing_dry_run)
  THEN
    RAISE EXCEPTION 'erasure_certificates: the subject of a certificate is immutable';
  END IF;

  IF OLD.status IN ('completed','failed','abandoned') THEN
    RAISE EXCEPTION 'erasure_certificates: % is terminal', OLD.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- SECURITY FIX — the legal-hold check could be blinded by RLS
-- ---------------------------------------------------------------
--
-- FOUND BY BUILDING INCREMENT 3, and it is a FAIL-OPEN defect in Increment 2.
--
-- `legal_holds` has row-level security keyed on app.current_org_id, and
-- erasure_agent is NOBYPASSRLS. So a hold query made AS erasure_agent — with no
-- tenant context set, which is the erasure executor's situation — returns ZERO
-- ROWS. Not an error. Not a refusal. Just an empty result that reads exactly
-- like "there is no hold on this tenant".
--
-- Both hold checks were exposed:
--   * the executor's own pre-flight check, and
--   * the EXISTS clause inside worm_guard_mutation, on the DIRECT path.
--
-- The cascade path happened to be safe by accident: PostgreSQL runs referential
-- actions with the table owner's rights, so the trigger's query saw the hold.
-- That is why the Increment 2 hold test passed — it went through a cascade. An
-- accident is not a control.
--
-- The fix is to read holds through a SECURITY DEFINER function, so the answer
-- is the truth regardless of the caller's role or tenant context. It cannot
-- fail open: with no rows visible to the caller it still counts the real ones.

CREATE OR REPLACE FUNCTION erasure_active_hold_count(target_org UUID)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::bigint FROM legal_holds
   WHERE organization_id = target_org AND status = 'active';
$$;

COMMENT ON FUNCTION erasure_active_hold_count(UUID) IS
  'Active legal holds for one organization, read with definer rights so the '
  'answer cannot be blinded by RLS or a missing tenant context. Both the '
  'erasure executor and the WORM guard use it; a hold must never be invisible '
  'to the thing it is supposed to stop.';

GRANT EXECUTE ON FUNCTION erasure_active_hold_count(UUID) TO erasure_agent;

-- Re-create the guard so its hold check goes through the definer function.
-- Everything else is byte-identical to Increment 2.
CREATE OR REPLACE FUNCTION worm_guard_mutation()
RETURNS trigger AS $$
DECLARE
  descriptor TEXT := COALESCE(TG_ARGV[0], 'append-only');
  verb       TEXT := COALESCE(TG_ARGV[1], 'is not permitted');
  suffix     TEXT := COALESCE(TG_ARGV[2], '');
  msg        TEXT;
  cert_id    UUID;
  claimed_org UUID;
  row_org    UUID;
  permitted  BOOLEAN := FALSE;
BEGIN
  IF TG_OP <> 'TRUNCATE' AND session_user = 'erasure_agent' THEN
    BEGIN
      cert_id     := NULLIF(current_setting('app.erasure_certificate_id', true), '')::uuid;
      claimed_org := NULLIF(current_setting('app.erasure_org_id', true), '')::uuid;
      row_org     := (to_jsonb(OLD) ->> 'organization_id')::uuid;

      permitted :=
             cert_id IS NOT NULL
         AND claimed_org IS NOT NULL
         AND row_org IS NOT NULL
         AND claimed_org = row_org
         AND EXISTS (
               SELECT 1 FROM erasure_certificates c
                WHERE c.id = cert_id
                  AND c.organization_id = claimed_org
                  AND c.status = 'executing'
                  AND c.dry_run = FALSE
             )
         -- Definer-rights read: an RLS policy must not be able to hide a hold
         -- from the guard that exists to honour it.
         AND erasure_active_hold_count(claimed_org) = 0;
    EXCEPTION WHEN OTHERS THEN
      permitted := FALSE;
    END;
  END IF;

  IF permitted THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  msg := TG_TABLE_NAME || ' is ' || descriptor || ': ' || TG_OP || ' ' || verb || suffix;
  RAISE EXCEPTION USING MESSAGE = msg;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- erasure_clear_blocking() — clearing without granting
-- ---------------------------------------------------------------
--
-- Seventeen FK edges REFUSE a parent delete rather than following it, so an
-- erasure must empty those child tables before deleting the organization.
-- Thirteen of them are org-scoped.
--
-- Granting erasure_agent DELETE on thirteen tenant tables — plus the SELECT
-- that a WHERE clause requires — would quietly undo the property Increment 2
-- established: that a stolen erasure credential can destroy a tenant but
-- cannot read one. So this runs with definer rights instead, and the role is
-- granted nothing on those tables at all.
--
-- The blocking set is DISCOVERED from the live FK graph, not listed. A future
-- table that adds a RESTRICT edge is handled automatically; a hard-coded list
-- would leave erasure silently broken until someone noticed.
--
-- Ordering is by retry rather than topological sort: attempt every table, keep
-- the failures, repeat while progress is being made, and raise if a pass
-- achieves nothing. Deterministic (tables are attempted in name order) and
-- bounded (passes cannot exceed the table count).
--
-- The WORM guard still applies. SECURITY DEFINER changes current_user, not
-- session_user, so `session_user = 'erasure_agent'` still holds and the guard
-- evaluates the certificate, the org match and the legal hold exactly as it
-- would on a direct delete. This function bypasses PRIVILEGES, never the guard.

CREATE OR REPLACE FUNCTION erasure_clear_blocking(target_org UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  targets   TEXT[];
  remaining TEXT[];
  failed    TEXT[];
  t         TEXT;
  n         BIGINT;
  progressed BOOLEAN;
  passes    INT := 0;
  result    JSONB := '{}'::jsonb;
BEGIN
  SELECT array_agg(DISTINCT c.relname ORDER BY c.relname) INTO targets
    FROM information_schema.referential_constraints rc
    JOIN pg_constraint con ON con.conname = rc.constraint_name
    JOIN pg_class c ON c.oid = con.conrelid
   WHERE rc.delete_rule IN ('RESTRICT','NO ACTION')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema='public' AND col.table_name=c.relname
          AND col.column_name='organization_id');

  IF targets IS NULL THEN RETURN result; END IF;
  remaining := targets;

  WHILE array_length(remaining,1) > 0 AND passes <= array_length(targets,1) LOOP
    passes := passes + 1;
    failed := ARRAY[]::TEXT[];
    progressed := FALSE;

    FOREACH t IN ARRAY remaining LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE organization_id = $1', t) USING target_org;
        GET DIAGNOSTICS n = ROW_COUNT;
        result := result || jsonb_build_object(t, COALESCE((result->>t)::bigint,0) + n);
        progressed := TRUE;
      EXCEPTION WHEN OTHERS THEN
        -- Another blocking child still references it; retry next pass. The
        -- implicit subtransaction of this block rolls back only this statement.
        failed := array_append(failed, t);
      END;
    END LOOP;

    IF NOT progressed AND array_length(failed,1) > 0 THEN
      RAISE EXCEPTION 'erasure: could not clear blocking tables: %', array_to_string(failed, ', ');
    END IF;
    remaining := failed;
  END LOOP;

  IF array_length(remaining,1) > 0 THEN
    RAISE EXCEPTION 'erasure: blocking tables unresolved: %', array_to_string(remaining, ', ');
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION erasure_clear_blocking(UUID) IS
  'Empties the org-scoped tables whose FK edges refuse a parent delete, with '
  'definer rights so the erasure role needs no privilege on tenant tables. '
  'Bypasses privileges, never the WORM guard: session_user is unchanged, so '
  'certificate, org-match and legal-hold checks all still apply.';

GRANT EXECUTE ON FUNCTION erasure_clear_blocking(UUID) TO erasure_agent;
