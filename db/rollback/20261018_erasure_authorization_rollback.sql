-- Rollback for 20261018_erasure_authorization.sql (E-2 Increment 2)
--
-- ORDERING MATTERS, and the scripts enforce it rather than documenting it:
-- run THIS first, then the Increment 1 rollback. Attempting Increment 1's
-- rollback while Increment 2 is still applied fails loudly with
-- "Refusing to drop worm_guard_mutation: N trigger(s) still reference it",
-- because erasure_certificates is guarded by that same shared function.
--
-- What this restores: the guard loses its exception and becomes unconditional
-- again, the certificate table and the role are removed, and tenant erasure
-- returns to being impossible (D-12 as it stood before Increment 2).
--
-- REFUSES rather than destroys: if any certificate row exists, this script
-- stops. A certificate is the durable proof that an erasure was authorized and
-- performed, retained for seven years by operator ruling; deleting one to make
-- a rollback tidy would destroy exactly the evidence the feature exists to
-- produce. An operator who genuinely intends that must do it deliberately and
-- separately.

BEGIN;

DO $$
DECLARE certs BIGINT;
BEGIN
  SELECT COUNT(*) INTO certs FROM erasure_certificates;
  IF certs > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop erasure_certificates: % certificate(s) exist. These are 7-year '
      'retention records proving governed erasure occurred; removing them is a separate, '
      'deliberate act, not a side effect of a rollback.', certs;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Remove the certificate surface
-- ---------------------------------------------------------------

DROP TRIGGER IF EXISTS prevent_erasure_certificates_truncate ON erasure_certificates;
DROP TRIGGER IF EXISTS prevent_erasure_certificates_delete ON erasure_certificates;
DROP TRIGGER IF EXISTS guard_erasure_certificates_update ON erasure_certificates;
DROP TABLE IF EXISTS erasure_certificates;
DROP FUNCTION IF EXISTS erasure_certificates_guard();

-- erasure_active_hold_count() is introduced by 20261019, not by this migration,
-- but it is dropped HERE and not by the Increment 3 rollback: that rollback
-- restores the Increment 2 guard, which calls this function. Dropping it there
-- would leave the restored guard referencing a function that no longer exists.
-- This is the first point in the chain at which nothing depends on it.
DROP FUNCTION IF EXISTS erasure_active_hold_count(UUID);

-- ---------------------------------------------------------------
-- 2. Return the guard to its unconditional (Increment 1) form
-- ---------------------------------------------------------------
--
-- Byte-for-byte the Increment 1 body: no exception, no context, no role check.

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

-- ---------------------------------------------------------------
-- 3. Remove the role and its privileges
-- ---------------------------------------------------------------

REVOKE ALL ON organizations FROM erasure_agent;
REVOKE ALL ON legal_holds FROM erasure_agent;
REVOKE ALL ON SCHEMA public FROM erasure_agent;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erasure_agent') THEN
    DROP ROLE erasure_agent;
  END IF;
END $$;

DELETE FROM schema_migrations WHERE filename = '20261018_erasure_authorization.sql';

COMMIT;
