-- Migration: erasure_authorization
-- Package:   E-2 Increment 2 — the credential-gated exception, shipped INERT
--
-- Adds the three things a certified erasure needs, and issues no credential, so
-- nothing can actually erase anything when this lands:
--
--   1. the `erasure_agent` role — created NOLOGIN, so no connection can be made
--      as it until a human deliberately grants it a password (Increment 4)
--   2. `erasure_certificates` — the durable record that an erasure was
--      authorized, by whom, and what it destroyed
--   3. the exception conditions inside the ONE shared WORM guard
--
-- ── WHY THE ROLE IS THE BOUNDARY, AND THE SESSION VARIABLE IS NOT ───────────
--
-- ADR-0005 proposed gating erasure on a session variable. Verified during E-2
-- discovery: ANY role, including the least-privileged `app_request`, may set
-- ANY custom GUC —
--
--     SET ROLE app_request;
--     SELECT set_config('app.erasure_authorized','whatever', true);   -- ALLOWED
--
-- so a variable is a statement of intent, not an authorization. An attacker who
-- reaches SQL through the application could set it and then delete the audit
-- rows that would have recorded them — which is the exact adversary the WORM
-- triggers exist to stop.
--
-- The gate is therefore `session_user = 'erasure_agent'`: something an attacker
-- must STEAL rather than DECLARE. The session variables remain, carrying which
-- organization and which certificate — they are what stops a legitimate
-- operator making a mistake, not what stops an adversary.
--
-- ── RESIDUAL LIMITATION, STATED HERE BECAUSE IT IS REAL ─────────────────────
--
-- The check is on `session_user`, not `current_user`, and that distinction is
-- load-bearing. `SET ROLE erasure_agent` changes current_user but NOT
-- session_user — verified — so role assumption cannot satisfy this guard. The
-- only ways to become erasure_agent are to connect with its credential (none
-- exists: NOLOGIN) or `SET SESSION AUTHORIZATION`, which requires SUPERUSER.
--
-- So the residual M-1 limitation is narrower than it first appears, and its
-- mechanism is worth naming precisely: while the application connects as the
-- database OWNER, it still cannot satisfy this guard — but an owner can
-- `ALTER TABLE … DISABLE TRIGGER`, which bypasses the guard entirely rather
-- than passing it. That was already true before Increment 2 and is unchanged
-- by it. What closes it is M-1 (the app connecting as a non-owner), not
-- anything in this migration. Both halves are tested in
-- test/isolation/erasureAuthorization.test.ts so the limitation cannot quietly
-- be forgotten or overstated.
--
-- ── WHAT REMAINS IMPOSSIBLE AFTER THIS MIGRATION ────────────────────────────
--
-- TRUNCATE is never permitted, by any path, ever. An erasure is org-scoped and
-- TRUNCATE cannot be; a hatch that allowed it would be a whole-table wipe with
-- a certificate stapled to it.

-- ---------------------------------------------------------------
-- 1. The role — created WITHOUT the ability to log in
-- ---------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erasure_agent') THEN
    -- NOLOGIN is the inertness. No password exists, and none can be used until
    -- an operator runs ALTER ROLE erasure_agent LOGIN PASSWORD '…' as a
    -- separate, authorized act. SET ROLE still works for tests, which is how
    -- the permit path is exercised without a credential existing anywhere.
    CREATE ROLE erasure_agent
      NOLOGIN
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT;
  END IF;
END $$;

COMMENT ON ROLE erasure_agent IS
  'E-2: the tenant-erasure identity. NOLOGIN until Increment 4 issues a '
  'credential. The WORM guard permits a certified erasure ONLY for this role.';

-- ---------------------------------------------------------------
-- 2. erasure_certificates — minimum evidence, no erased content
-- ---------------------------------------------------------------
--
-- MINIMALITY IS A REQUIREMENT, NOT A STYLE (operator ruling, 7-year retention):
-- the certificate must prove that a governed erasure happened without
-- preserving the thing that was erased. So it holds identifiers and counts and
-- nothing else:
--
--   * `organization_id` is a bare UUID with NO FOREIGN KEY. Two reasons: an FK
--     would cascade the certificate away with the org it certifies, and the
--     UUID is a pseudonymous identifier rather than customer content.
--   * `organization_name_digest` is a SHA-256 of the name, not the name. A
--     later dispute can VERIFY a claimed name against the digest; nobody can
--     read the customer's name back out of it.
--   * `scope_digest` holds ROW COUNTS BY TABLE — magnitude, never content. No
--     titles, no ids of erased rows, no free text about the data.
--   * actor columns are bare UUIDs, no FK, for the same reason as the org.
--
-- There is deliberately no column that could hold a conversation, a finding, an
-- email address or a name.

CREATE TABLE IF NOT EXISTS erasure_certificates (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subject. No FK, by design (see above).
  organization_id           UUID        NOT NULL,
  organization_name_digest  TEXT        NULL,

  -- Two-person authorization. Both are required before execution, and the
  -- CHECK below refuses self-approval at the database level.
  requested_by_user_id      UUID        NOT NULL,
  approved_by_user_id       UUID        NULL,

  -- Governance text authored by an operator — not customer content.
  reason                    TEXT        NOT NULL,
  legal_basis               TEXT        NOT NULL
                              CHECK (legal_basis IN (
                                'gdpr_art17_request',
                                'contract_termination',
                                'operator_decommission'
                              )),

  -- A rehearsal enumerates and reports; it never mutates. The guard refuses to
  -- permit anything for a dry-run certificate, so this flag is load-bearing.
  dry_run                   BOOLEAN     NOT NULL DEFAULT TRUE,

  status                    TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','approved','executing','completed','failed','abandoned')),

  -- Magnitude of what was destroyed: {"table_name": count}. Never content.
  scope_digest              JSONB       NULL,

  requested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at               TIMESTAMPTZ NULL,
  started_at                TIMESTAMPTZ NULL,
  completed_at              TIMESTAMPTZ NULL,

  -- Operator ruling: retain for seven years. Set on completion.
  retain_until              TIMESTAMPTZ NULL,

  CONSTRAINT erasure_certificates_two_person CHECK (
    approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id
  ),
  CONSTRAINT erasure_certificates_approval_shape CHECK (
    (status = 'draft' AND approved_by_user_id IS NULL AND approved_at IS NULL)
    OR (status <> 'draft' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_erasure_certificates_org
  ON erasure_certificates (organization_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_erasure_certificates_open
  ON erasure_certificates (status) WHERE status IN ('approved','executing');

COMMENT ON TABLE erasure_certificates IS
  'Durable proof that a governed tenant erasure was authorized and performed. '
  'Deliberately holds identifiers, counts and governance text only — never any '
  'of the customer content that was erased. organization_id and the actor '
  'columns carry NO foreign key so the certificate outlives its subject.';

-- The certificate is itself append-plus-advance: rows are never deleted, and
-- the only permitted UPDATE advances the lifecycle. Subject fields are frozen.
CREATE OR REPLACE FUNCTION erasure_certificates_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.requested_by_user_id <> OLD.requested_by_user_id
     OR NEW.reason <> OLD.reason
     OR NEW.legal_basis <> OLD.legal_basis
     OR NEW.dry_run IS DISTINCT FROM OLD.dry_run
     OR NEW.requested_at <> OLD.requested_at
  THEN
    RAISE EXCEPTION 'erasure_certificates: the subject of a certificate is immutable';
  END IF;

  IF OLD.status IN ('completed','failed','abandoned') THEN
    RAISE EXCEPTION 'erasure_certificates: % is terminal', OLD.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_erasure_certificates_update ON erasure_certificates;
CREATE TRIGGER guard_erasure_certificates_update
  BEFORE UPDATE ON erasure_certificates
  FOR EACH ROW EXECUTE FUNCTION erasure_certificates_guard();

DROP TRIGGER IF EXISTS prevent_erasure_certificates_delete ON erasure_certificates;
CREATE TRIGGER prevent_erasure_certificates_delete
  BEFORE DELETE ON erasure_certificates
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (certificate)');

DROP TRIGGER IF EXISTS prevent_erasure_certificates_truncate ON erasure_certificates;
CREATE TRIGGER prevent_erasure_certificates_truncate
  BEFORE TRUNCATE ON erasure_certificates
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (certificate)');

-- ---------------------------------------------------------------
-- 3. The guard gains its exception — in ONE place
-- ---------------------------------------------------------------
--
-- Every condition must hold. They are ordered cheapest-first, and the whole
-- block is wrapped so that ANY malformed input falls through to the refusal
-- rather than being interpreted generously.

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
  -- TRUNCATE is never permitted by any path. It cannot be organization-scoped,
  -- so a certified TRUNCATE would be a whole-table wipe with paperwork.
  IF TG_OP <> 'TRUNCATE' AND session_user = 'erasure_agent' THEN
    BEGIN
      cert_id     := NULLIF(current_setting('app.erasure_certificate_id', true), '')::uuid;
      claimed_org := NULLIF(current_setting('app.erasure_org_id', true), '')::uuid;
      -- OLD, never NEW: an FK-driven SET NULL arrives as an UPDATE whose NEW
      -- organization_id is already NULL. The row's tenancy is in the pre-image.
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
         -- E-1 dominance: a legal hold outranks every erasure path, enforced
         -- in the database and not only in the executor that calls it.
         AND NOT EXISTS (
               SELECT 1 FROM legal_holds h
                WHERE h.organization_id = claimed_org
                  AND h.status = 'active'
             );
    EXCEPTION WHEN OTHERS THEN
      -- A malformed GUC, a missing column, anything at all: fail closed.
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

COMMENT ON FUNCTION worm_guard_mutation() IS
  'The single WORM policy, and the single certified-erasure exception. Permits '
  'a mutation ONLY when the session_user is erasure_agent, the asserted org '
  'matches the row, an executing non-dry-run certificate exists for it, and no '
  'active legal hold covers it. TRUNCATE is never permitted. Anything '
  'malformed fails closed.';

-- ---------------------------------------------------------------
-- 4. The capability model — deliberately tiny
-- ---------------------------------------------------------------
--
-- A tenant erasure is one statement: DELETE FROM organizations WHERE id = ...
-- Everything else happens by FK cascade, and PostgreSQL runs referential
-- actions with the TABLE OWNER's rights, not the caller's. Verified: an
-- erasure_agent holding privileges on `organizations` ALONE cascades into
-- ask_conversations, security_audit_log and the rest, with no grant on any of
-- them.
--
-- So this role is granted almost nothing:
--
--   * SELECT, DELETE on `organizations` — the erasure root. SELECT is required
--     because a DELETE with a WHERE clause reads the predicate columns.
--   * SELECT on `legal_holds` and `erasure_certificates` — the guard evaluates
--     these as the invoking user on a direct (non-cascade) mutation.
--   * INSERT/UPDATE on `erasure_certificates` — to advance its own certificate.
--
-- It is granted NOTHING on the nine WORM tables. It cannot read a finding, a
-- conversation, an assessment or an audit row; it can only cause the root
-- delete whose cascade the guard then adjudicates row by row. An erasure
-- credential stolen from Increment 4 is therefore not a data-exfiltration
-- credential — it can destroy a tenant, and it cannot read one.

GRANT USAGE ON SCHEMA public TO erasure_agent;

GRANT SELECT, DELETE ON organizations TO erasure_agent;
GRANT SELECT ON legal_holds TO erasure_agent;
GRANT SELECT, INSERT, UPDATE ON erasure_certificates TO erasure_agent;

-- The application may record and read certificates; it can never satisfy the
-- guard, so this grants visibility, not capability.
GRANT SELECT, INSERT ON erasure_certificates TO app_request;
