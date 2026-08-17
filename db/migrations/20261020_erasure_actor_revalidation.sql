-- Migration: erasure_actor_revalidation
-- Package:   E-2 Increment 3 — operator ruling, 2026-08-16
--
-- THE RULING. A deprovisioned or no-longer-authorized approver INVALIDATES an
-- outstanding erasure approval. Both the requester and the approver must be
-- revalidated immediately before destructive execution, and a failure requires
-- fresh authorization rather than a retry.
--
-- WHAT THIS CHANGES. Increment 3 shipped with the opposite behaviour, recorded
-- honestly at the time as "observed, not assumed": an approval was bound to the
-- SCOPE, and an approver deprovisioned afterwards did not void it. The ruling
-- settles it the other way, and the reasoning is sound — a two-person control
-- whose second person has since been removed from the organization is a
-- one-person control with a historical footnote.
--
-- WHY A FUNCTION AND NOT A QUERY. The executor runs as `erasure_agent`, which
-- holds NO privilege on `users` — deliberately, so a stolen erasure credential
-- cannot enumerate people. A direct SELECT would therefore fail, and worse, a
-- careless fix would be to grant it read access to the user table. Definer
-- rights keep the property: the executor learns one boolean per actor and can
-- read nothing.
--
-- FAIL CLOSED, in every direction:
--   * user row missing (hard-deleted)          -> NOT authorized
--   * status <> 'active' (inactive, pending
--     deletion, deleted, tombstoned)           -> NOT authorized
--   * role <> 'admin' (demoted since approval) -> NOT authorized
--   * NULL actor id                            -> NOT authorized
--   * wrong organization                       -> NOT authorized
--
-- The organization match matters: an approver must have been an admin OF THE
-- TENANT BEING ERASED. Without it an admin of any other organization would
-- satisfy the check.

CREATE OR REPLACE FUNCTION erasure_actor_authorized(
  actor_id UUID,
  target_org UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = actor_id
       AND u.organization_id = target_org
       AND u.status = 'active'
       AND u.role = 'admin'
  );
$$;

COMMENT ON FUNCTION erasure_actor_authorized(UUID, UUID) IS
  'Is this actor STILL an active admin of this organization? Re-evaluated '
  'immediately before destructive execution, per the 2026-08-16 ruling that a '
  'deprovisioned approver invalidates an outstanding approval. Definer rights '
  'so the erasure role learns one boolean and cannot read the user table. '
  'Returns FALSE for a missing row, a non-active status, a demoted role, a NULL '
  'actor or a mismatched organization — fail closed in every direction.';

GRANT EXECUTE ON FUNCTION erasure_actor_authorized(UUID, UUID) TO erasure_agent;

-- ---------------------------------------------------------------
-- A narrow exception the first real erasure would otherwise have hit
-- ---------------------------------------------------------------
--
-- FOUND BY REHEARSING. `security_audit_log.actor_user_id` is
-- ON DELETE SET NULL, and `security_audit_log.organization_id` is NULLABLE —
-- platform-level events legitimately carry no organization.
--
-- Erasing a tenant cascade-deletes its users, which fires a SET NULL UPDATE on
-- every audit row referencing them, INCLUDING platform-level rows whose
-- organization_id is already NULL. The guard reads the row's organization to
-- decide, sees NULL, cannot match it against the certificate's org, and
-- refuses — so the whole erasure fails.
--
-- Reproduced: a single NULL-org audit row referencing a user of the target
-- tenant is enough to make the tenant permanently un-erasable. In production
-- that is not an edge case; it is what happens the first time any platform-level
-- event records a tenant user as its actor.
--
-- THE EXCEPTION, deliberately as narrow as it can be made:
--   * UPDATE only — never DELETE.
--   * The row must have NO organization (platform-level). A row belonging to a
--     DIFFERENT tenant still refuses; that would be a cross-tenant write and it
--     should fail loudly.
--   * actor_user_id must be going from a value to NULL — an anonymization.
--   * EVERY other column must be byte-identical. Compared as JSONB with the
--     actor removed, so a new column cannot silently widen this later.
--
-- What it therefore permits is exactly: "stop pointing at a user who no longer
-- exists". It cannot delete an audit row, cannot alter one, and cannot touch a
-- row belonging to another tenant.

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
  old_j      JSONB;
  new_j      JSONB;
  permitted  BOOLEAN := FALSE;
  certified  BOOLEAN := FALSE;
BEGIN
  IF TG_OP <> 'TRUNCATE' AND session_user = 'erasure_agent' THEN
    BEGIN
      cert_id     := NULLIF(current_setting('app.erasure_certificate_id', true), '')::uuid;
      claimed_org := NULLIF(current_setting('app.erasure_org_id', true), '')::uuid;
      row_org     := (to_jsonb(OLD) ->> 'organization_id')::uuid;

      certified :=
             cert_id IS NOT NULL
         AND claimed_org IS NOT NULL
         AND EXISTS (
               SELECT 1 FROM erasure_certificates c
                WHERE c.id = cert_id
                  AND c.organization_id = claimed_org
                  AND c.status = 'executing'
                  AND c.dry_run = FALSE
             )
         AND erasure_active_hold_count(claimed_org) = 0;

      IF certified AND row_org IS NOT NULL AND row_org = claimed_org THEN
        permitted := TRUE;

      ELSIF certified AND row_org IS NULL AND TG_OP = 'UPDATE' THEN
        -- Platform-level row losing its reference to an erased user.
        old_j := to_jsonb(OLD);
        new_j := to_jsonb(NEW);
        permitted :=
              (old_j ? 'actor_user_id')
          AND (old_j ->> 'actor_user_id') IS NOT NULL
          AND (new_j ->> 'actor_user_id') IS NULL
          AND (old_j - 'actor_user_id') = (new_j - 'actor_user_id');
      END IF;
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
