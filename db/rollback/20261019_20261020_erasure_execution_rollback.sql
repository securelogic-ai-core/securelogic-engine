-- Rollback for the E-2 Increment 3 migrations
--   20261019_erasure_execution_state.sql
--   20261020_erasure_actor_revalidation.sql
--
-- ORDER: run this FIRST, before the Increment 2 rollback
-- (20261018_erasure_authorization_rollback.sql), which must itself run before
-- the Increment 1 rollback. Each script refuses loudly if run out of order
-- rather than leaving a half-dismantled control.
--
-- WHAT IT RESTORES. The executor's scope binding, expiry and attempt state are
-- removed; the guard returns to its Increment 2 form — certified erasure still
-- possible, but with no actor revalidation and no platform-row anonymisation.
-- Erasure remains impossible in practice because no credential exists.
--
-- REFUSES rather than destroys, twice:
--   * if any certificate row exists — those are seven-year retention records
--   * if any certificate has ever been executed (attempt_count > 0), because
--     rolling back the execution state of a real erasure would erase the record
--     of how it was authorised
--
-- The dry_run relaxation from 20261019 is NOT reverted: re-freezing dry_run
-- would make the second person unable to clear a certificate for destruction,
-- which is a worse state than either increment intended.

BEGIN;

DO $$
DECLARE certs BIGINT; attempted BIGINT;
BEGIN
  SELECT COUNT(*) INTO certs FROM erasure_certificates;
  IF certs > 0 THEN
    RAISE EXCEPTION
      'Refusing: % erasure certificate(s) exist. These are seven-year retention '
      'records; removing their execution state is a separate, deliberate act.', certs;
  END IF;
  SELECT COUNT(*) INTO attempted FROM erasure_certificates WHERE attempt_count > 0;
  IF attempted > 0 THEN
    RAISE EXCEPTION 'Refusing: % certificate(s) record execution attempts.', attempted;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. 20261020 — actor revalidation and the platform-row exception
-- ---------------------------------------------------------------
--
-- The guard returns to its Increment 2 body: certificate + org match + hold,
-- with no org-less anonymisation branch.

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
                WHERE c.id = cert_id AND c.organization_id = claimed_org
                  AND c.status = 'executing' AND c.dry_run = FALSE
             )
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

DROP FUNCTION IF EXISTS erasure_actor_authorized(UUID, UUID);

-- ---------------------------------------------------------------
-- 2. 20261019 — execution state, scope binding and the helpers
-- ---------------------------------------------------------------

ALTER TABLE erasure_certificates DROP CONSTRAINT IF EXISTS erasure_certificates_approved_scope;

ALTER TABLE erasure_certificates
  DROP COLUMN IF EXISTS scope_fingerprint,
  DROP COLUMN IF EXISTS inventory_snapshot,
  DROP COLUMN IF EXISTS approval_expires_at,
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS last_attempt_at,
  DROP COLUMN IF EXISTS failure_reason;

DROP FUNCTION IF EXISTS erasure_clear_blocking(UUID);
DROP FUNCTION IF EXISTS erasure_inventory(UUID);
DROP FUNCTION IF EXISTS erasure_scanned_table_count();

-- erasure_active_hold_count is NOT dropped here even though 20261019 introduced
-- it: the Increment 2 guard restored above CALLS it, so dropping it now would
-- leave a guard referencing a missing function. It is dropped by the Increment 2
-- rollback instead — the first point in the chain where nothing depends on it.

REVOKE INSERT ON security_audit_log FROM erasure_agent;

DELETE FROM schema_migrations
 WHERE filename IN ('20261019_erasure_execution_state.sql',
                    '20261020_erasure_actor_revalidation.sql');

COMMIT;
