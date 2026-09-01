-- =====================================================================
-- 20261084 — The governed evidence writer: curation guard + withdrawal
-- =====================================================================
--
-- Two halves of one package, both about who may change an evidence artifact's
-- governance envelope and who may destroy it:
--
--   PART A  establishing assurance_class and validity is WRITE-ONCE
--   PART B  withdraw_evidence() — the governed destruction path
--
--
-- Owner ruling, 2026-09-01: "Governed withdrawal path — detach all links,
-- record events, then permit deletion."
--
-- THE CONFLICT THIS RESOLVES
--
--   vendorPortal.ts's evidence delete is a HARD delete, deliberately: "a vendor
--   who attached the wrong document — the wrong client's report, an unredacted
--   export — needs it gone, not flagged." That is a data-protection
--   requirement.
--
--   20261081 made evidence_links.evidence_id ON DELETE RESTRICT, deliberately:
--   an artifact in use must not be deleted out from under the decision that
--   used it.
--
--   Both are right, and once a link exists they are irreconcilable by a plain
--   DELETE. This migration adds the one operation that satisfies both: an
--   atomic, attributed, fully recorded withdrawal.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT A DELETE GRANT
--
--   app_request deliberately holds NO DELETE on evidence_links. Granting it
--   would make every link row deletable by any query — the exact property
--   20261081 exists to prevent. A guard trigger cannot be used to narrow such a
--   grant either: any trigger whose definition mentions DELETE must resolve to
--   the shared worm_guard_mutation (wormGuardConsolidation.test.ts fails the
--   build otherwise), and that guard refuses deletes outright.
--
--   So the capability exists ONLY as this function: one all-or-nothing sequence
--   that cannot be partially performed, cannot run unattributed, and cannot run
--   without writing the record first. Same shape as erasure_inventory()
--   (20261019) — a definer's-rights function that grants a narrow power without
--   granting the broad privilege underneath it.
--
-- WHO MAY CALL IT
--
--   An attributed human in the OWNING organization, through the internal
--   reviewer surface. NOT the vendor portal. A vendor being able to destroy
--   evidence a reviewer already confirmed would hand an external party a way to
--   delete inconvenient proof after the fact; the portal keeps its hard delete
--   for artifacts that own no link, and refuses with evidence_in_use once one
--   exists. That is an authorization boundary the route layer enforces and this
--   function's attribution requirement backstops.
--
-- WHAT SURVIVES THE DELETION
--
--   evidence_lifecycle_events holds evidence_id and link_id BY VALUE with no FK
--   — a Step 2 decision made precisely so the stream outlives its subject. After
--   a withdrawal the artifact and its links are gone and the record of what was
--   destroyed, by whom, and why remains, append-only and WORM-guarded.
--
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------
-- PART A — establishing the governance envelope is WRITE-ONCE
-- ---------------------------------------------------------------
--
-- routes/evidence.ts states the rule this package must not break: "Evidence
-- records are write-once. There is no PATCH and no DELETE route." Step 2 and
-- Step 3 nonetheless added columns a human is MEANT to fill in after creation —
-- assurance_class starts 'unclassified' and validity_basis starts
-- 'not_established' precisely so a person can establish them later.
--
-- The reconciliation: the CONTENT stays immutable, and the governance envelope
-- is established EXACTLY ONCE. A curator may say what an artifact is and how
-- long it is good for; nobody may quietly restate it afterwards, because a
-- determination already made would silently change meaning underneath itself.
-- Same discipline as evidence_links' write-once confirmation.
--
-- Re-establishing is not forbidden forever — it is forbidden SILENTLY. The
-- supported way to change what an artifact asserts is to supersede it with a
-- new version, which is what supersedes_evidence_id exists for.
--
-- BEFORE INSERT OR UPDATE only: a trigger whose definition mentions DELETE or
-- TRUNCATE must resolve to the shared worm_guard_mutation
-- (wormGuardConsolidation.test.ts fails the build otherwise).

CREATE OR REPLACE FUNCTION evidence_envelope_write_once()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- assurance_class: 'unclassified' -> a real class is the one allowed move.
  IF OLD.assurance_class IS DISTINCT FROM NEW.assurance_class
     AND OLD.assurance_class <> 'unclassified' THEN
    RAISE EXCEPTION
      'evidence.assurance_class is write-once: it is already %, supersede the artifact instead',
      OLD.assurance_class
      USING ERRCODE = '23514';
  END IF;

  -- validity: 'not_established' -> an established basis is the one allowed move.
  IF OLD.validity_basis IS DISTINCT FROM NEW.validity_basis
     AND OLD.validity_basis <> 'not_established' THEN
    RAISE EXCEPTION
      'evidence.validity_basis is write-once: it is already %, supersede the artifact instead',
      OLD.validity_basis
      USING ERRCODE = '23514';
  END IF;

  -- Once a window is established its dates are frozen too, or the basis would
  -- say "a human committed this" about dates the human never saw.
  IF OLD.validity_basis <> 'not_established'
     AND (OLD.valid_from IS DISTINCT FROM NEW.valid_from
          OR OLD.valid_until IS DISTINCT FROM NEW.valid_until) THEN
    RAISE EXCEPTION
      'evidence validity dates are frozen once established: supersede the artifact instead'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_evidence_envelope_write_once
  BEFORE UPDATE ON evidence
  FOR EACH ROW
  EXECUTE FUNCTION evidence_envelope_write_once();

COMMENT ON FUNCTION evidence_envelope_write_once() IS
  'assurance_class and the validity window may be ESTABLISHED once, from their '
  'fail-closed defaults, and never restated. Keeps routes/evidence.ts''s '
  'write-once promise true while letting Step 2/3''s curation columns be filled '
  'in by a human. To change what an artifact asserts, supersede it.';

-- ---------------------------------------------------------------
-- PART B — governed withdrawal
-- ---------------------------------------------------------------

-- ---------------------------------------------------------------
-- 1. 'withdrawn' joins the event vocabulary
-- ---------------------------------------------------------------
--
-- A withdrawal is not a detach. Detaching ends a USE; withdrawing destroys the
-- ARTIFACT. Recording the second as the first would leave the surviving stream
-- unable to say that the file no longer exists — and after the delete this
-- stream is the only record there is.

ALTER TABLE evidence_lifecycle_events
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_event_type_check;
ALTER TABLE evidence_lifecycle_events
  ADD CONSTRAINT evidence_lifecycle_event_type_check CHECK (
    event_type IN (
      'linked',                       -- a use was recorded
      'confirmed',                    -- a human confirmed THAT use
      'detached',                     -- a use ended
      'superseded',                   -- a newer version of the artifact arrived
      'validity_established',         -- a human committed valid_from/valid_until
      'assurance_class_established',  -- a human committed the assurance class
      'expiry_observed',              -- the sweep NOTICED an expiry; it flips nothing
      'withdrawn'                     -- the ARTIFACT itself was destroyed (20261084)
    )
  );

-- ---------------------------------------------------------------
-- 2. withdraw_evidence() — the whole sequence, or none of it
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION withdraw_evidence(
  p_evidence_id   UUID,
  p_actor_user_id UUID,
  p_reason        TEXT
)
RETURNS TABLE (
  links_detached    INTEGER,
  links_removed     INTEGER,
  original_filename TEXT,
  sha256            TEXT,
  byte_size         BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org       UUID;
  v_reason    TEXT;
  v_ev        RECORD;
  v_detached  INTEGER := 0;
  v_removed   INTEGER := 0;
  v_superseder UUID;
BEGIN
  -- Tenant authority comes from the session, never from a parameter. This
  -- function runs with definer's rights, so RLS does not constrain it; the GUC
  -- is what keeps it inside one organization, and it is the same boundary every
  -- RLS policy in this schema already trusts.
  v_org := NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'tenant_context_missing' USING ERRCODE = '42501';
  END IF;

  -- No unattributed destruction, and no attributing it to somebody else's user.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'withdrawal_requires_an_actor' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = p_actor_user_id AND u.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'actor_not_in_organization' USING ERRCODE = '42501';
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'withdrawal_requires_a_reason' USING ERRCODE = '23514';
  END IF;

  -- Take the row under lock so a concurrent link cannot slip in between the
  -- detach and the delete.
  SELECT e.id, e.original_filename, e.byte_size, e.sha256
    INTO v_ev
    FROM evidence e
   WHERE e.id = p_evidence_id
     AND e.organization_id = v_org
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  -- A later version pointing at this row also RESTRICTs the delete. Repointing
  -- the chain silently would rewrite provenance, so refuse and say why.
  SELECT e2.id INTO v_superseder
    FROM evidence e2
   WHERE e2.supersedes_evidence_id = p_evidence_id
     AND e2.organization_id = v_org
   LIMIT 1;
  IF v_superseder IS NOT NULL THEN
    RAISE EXCEPTION 'evidence_is_superseded_by_another_version: %', v_superseder
      USING ERRCODE = '23503';
  END IF;

  -- Detach every live link. The guard trigger still fires here — a withdrawal
  -- obeys the same detach rules a reviewer does.
  WITH live AS (
    SELECT id FROM evidence_links
     WHERE evidence_id = p_evidence_id
       AND organization_id = v_org
       AND detached_at IS NULL
  )
  UPDATE evidence_links l
     SET detached_at        = NOW(),
         detached_by_user_id = p_actor_user_id,
         -- detach_reason is a CLOSED vocabulary (20261081), and Step 2 already
         -- reserved 'withdrawn' for exactly this. The human's words go in the
         -- event detail, which is where free text belongs.
         detach_reason      = 'withdrawn',
         updated_at         = NOW()
    FROM live
   WHERE l.id = live.id;
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  -- Write the record BEFORE destroying what it describes.
  INSERT INTO evidence_lifecycle_events
    (organization_id, evidence_id, link_id, event_type, actor_user_id, detail)
  SELECT v_org, p_evidence_id, l.id, 'detached', p_actor_user_id,
         jsonb_build_object(
           'cause', 'artifact_withdrawn',
           'reason', v_reason,
           'target_type', l.target_type,
           'target_id', l.target_id,
           'target_requirement_id', l.target_requirement_id,
           'was_confirmed', (l.confirmed_at IS NOT NULL)
         )
    FROM evidence_links l
   WHERE l.evidence_id = p_evidence_id
     AND l.organization_id = v_org;

  INSERT INTO evidence_lifecycle_events
    (organization_id, evidence_id, link_id, event_type, actor_user_id, detail)
  VALUES (
    v_org, p_evidence_id, NULL, 'withdrawn', p_actor_user_id,
    jsonb_build_object(
      'reason', v_reason,
      'original_filename', v_ev.original_filename,
      'sha256', v_ev.sha256,
      'byte_size', v_ev.byte_size,
      'links_detached_by_withdrawal', v_detached
    )
  );

  DELETE FROM evidence_links
   WHERE evidence_id = p_evidence_id
     AND organization_id = v_org;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- evidence_analysis is ON DELETE CASCADE and goes with it.
  DELETE FROM evidence
   WHERE id = p_evidence_id
     AND organization_id = v_org;

  links_detached    := v_detached;
  links_removed     := v_removed;
  original_filename := v_ev.original_filename;
  sha256            := v_ev.sha256;
  byte_size         := v_ev.byte_size;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION withdraw_evidence(UUID, UUID, TEXT) IS
  'Governed withdrawal of one evidence artifact (owner ruling 2026-09-01): '
  'detach every live link, write the full record, remove the links, delete the '
  'artifact — atomically or not at all. SECURITY DEFINER so the capability '
  'exists WITHOUT granting app_request a general DELETE on evidence_links, '
  'which is the privilege 20261081 deliberately withholds. Tenant authority '
  'comes from app.current_org_id, never a parameter. Refuses an unattributed '
  'caller, an actor outside the organization, an empty reason, and an artifact '
  'a later version supersedes. The surviving record lives in '
  'evidence_lifecycle_events, which holds evidence_id/link_id by value with no '
  'FK precisely so it outlives what it describes.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT EXECUTE ON FUNCTION withdraw_evidence(UUID, UUID, TEXT) TO app_request;
  END IF;
END $$;

COMMIT;
