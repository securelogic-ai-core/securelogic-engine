-- Migration: vendor_engagement_assignments
-- Package:   Vendor Assurance — VA-D1 (questionnaire delegation and work tracking)
--
-- WHO IS EXPECTED TO DO THE WORK — which is not who did it.
--
-- VA-P1 gave a supplier several people on one questionnaire. They could all see
-- every question and all answer any of them, which is access, not organisation:
-- nothing recorded who was supposed to answer what, so nobody could tell what
-- was outstanding, who was blocked, or which colleague to chase.
--
-- ── The distinction this table exists to preserve ──────────────────────────
--
--   ASSIGNED TO      responsibility for work        <- this table
--   ANSWERED BY      who performed the response act <- requirement_responses
--                                                      .answered_via_invite_id
--                                                      -> invite -> participant
--
-- They are different facts and both must survive. A coordinator may legitimately
-- answer a question assigned to somebody else; that must record a response by
-- the coordinator WITHOUT rewriting who the work was delegated to, because
-- "Susan never did her 18" and "Susan's 18 got done" are different situations
-- and the supplier's manager needs to tell them apart.
--
-- ── Why NOT vendor_engagement_scope_items (owner ruling 2026-08-23) ────────
--
-- That table is the FROZEN issued scope: written once at `issued` and never
-- rewritten, because a vendor's answers are only meaningful against the
-- questions they were actually asked. It has no updated_at and no assignee, and
-- that is deliberate. Hanging mutable, reassignable state on it would destroy
-- the property that makes the frozen scope trustworthy. Assignment gets its own
-- table.
--
-- ── Sections are framework_id, and are NOT stored here (owner ruling) ──────
--
-- Assignment is ALWAYS per requirement. "Assign ISO 42001 to Susan" is a
-- read-side bulk action that expands into one row per currently-scoped ISO
-- 42001 requirement. No section object is persisted.
--
-- The ruling settled the taxonomy question that blocked this package:
-- `scope_tags` is an APPLICABILITY vocabulary (multi-valued, overlapping, and
-- derived heuristically from `reference_id || ' ' || title`), and `reference_id`
-- is unvalidated free text — neither is an authoritative section taxonomy, and
-- inferring one from display text was explicitly refused. `framework_id` is a
-- NOT NULL FK, single-valued, and cannot be wrong.
--
-- Because assignment is stored per requirement, a richer taxonomy later
-- (Security / Privacy / Access Control / …) changes only the grouping and
-- bulk-selection layer. It cannot invalidate a single historical assignment.
-- That future taxonomy is a recorded product requirement and is deliberately
-- NOT invented here.
--
-- ── History is IN BAND, not only in the audit log ──────────────────────────
--
-- APPEND-ONLY LEDGER OF ASSIGNMENT ACTS. Reassigning does not UPDATE a row: it
-- stamps the current row `superseded_at` and inserts the next one. The current
-- assignment for a question is the single row with `superseded_at IS NULL`.
--
-- The audit log could carry these transitions, but audit writes on this
-- platform are deliberately fire-and-forget (a failed audit write must never
-- fail a vendor's action), which makes them at-most-once. Delegation history is
-- something a supplier's manager and a customer's reviewer both reason about,
-- so it lives in a table with the same durability as the work itself — the same
-- reasoning that produced requirement_response_revisions and
-- pen_test_finding_retests.
--
-- Additive only. Empty at birth. RLS lands with the table.

CREATE TABLE IF NOT EXISTS vendor_engagement_assignments (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Denormalised for the same reason vendor_engagement_participants denormalises
  -- it: the isolation predicate is needed on every lookup of an externally
  -- reachable surface, and reaching it through a join is where a mistake hides.
  -- Kept honest by the trigger below.
  vendor_id                  UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  engagement_id              UUID        NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  -- The QUESTION. RESTRICT because an assignment naming a requirement that no
  -- longer exists is a history that cannot be read back.
  requirement_id             UUID        NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,

  -- NULL means UNASSIGNED — the work exists and nobody owns it. This is a real
  -- state with a real cause (nobody has picked it up yet; the coordinator
  -- cleared it; the assignee was revoked), not an absence of a row, because a
  -- missing row cannot say WHY the work is unowned or WHEN it became unowned.
  assigned_to_participant_id UUID        NULL REFERENCES vendor_engagement_participants(id) ON DELETE RESTRICT,

  -- Who performed the act. A vendor coordinator, or a customer user. At most
  -- one; BOTH NULL is legal and means an API-key caller with no user behind it,
  -- exactly as on vendor_engagement_participants.
  assigned_by_participant_id UUID        NULL REFERENCES vendor_engagement_participants(id) ON DELETE SET NULL,
  assigned_by_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  -- What KIND of act this row records. Reconstructing "who reassigned Susan's
  -- work to Robert and when" needs the verb, not just the two states.
  assignment_action          TEXT        NOT NULL
                               CHECK (assignment_action IN
                                 ('assigned', 'reassigned', 'unassigned', 'vacated_on_revocation')),

  -- Whether the act came from picking one question or from a framework bulk
  -- action. Recorded because "Susan was given 18 questions individually" and
  -- "Susan was given a framework" are different management facts, and because a
  -- bulk action that went wrong needs to be identifiable as one.
  assignment_source          TEXT        NOT NULL DEFAULT 'question'
                               CHECK (assignment_source IN ('question', 'framework_bulk')),

  note                       TEXT        NULL,

  assigned_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = this is the CURRENT assignment for its question. Non-null = history.
  superseded_at              TIMESTAMPTZ NULL,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The verb and the assignee must agree. An 'assigned' row with nobody on it,
  -- or an 'unassigned' row naming somebody, is a record that cannot be read.
  CONSTRAINT vendor_engagement_assignments_action_matches_assignee CHECK (
    (assignment_action IN ('assigned', 'reassigned')) = (assigned_to_participant_id IS NOT NULL)
  ),
  CONSTRAINT vendor_engagement_assignments_one_actor CHECK (
    NOT (assigned_by_participant_id IS NOT NULL AND assigned_by_user_id IS NOT NULL)
  )
);

-- EXACTLY ONE CURRENT ROW PER QUESTION. This is what makes "the current
-- assignment" a lookup rather than a computation over an ordered ledger, and it
-- makes a double-assign a database error instead of two people both believing
-- they own the same question.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_engagement_assignments_current
  ON vendor_engagement_assignments (organization_id, engagement_id, requirement_id)
  WHERE superseded_at IS NULL;

-- "What is Susan working on" — the Assigned-to-Me query.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_assignments_assignee
  ON vendor_engagement_assignments (assigned_to_participant_id, superseded_at)
  WHERE assigned_to_participant_id IS NOT NULL;

-- The coordinator's board, and the history read for one question.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_assignments_engagement
  ON vendor_engagement_assignments (organization_id, engagement_id, superseded_at);

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_assignments_history
  ON vendor_engagement_assignments (engagement_id, requirement_id, assigned_at DESC);

COMMENT ON TABLE vendor_engagement_assignments IS
  'Append-only ledger of who is EXPECTED to answer each question of one vendor '
  'assessment. Not who answered it — that is requirement_responses'
  '.answered_via_invite_id -> invite -> participant, and the two must never be '
  'collapsed. Reassignment supersedes and inserts; it never updates in place. '
  'Sections are not stored: a framework bulk action expands to one row per '
  'requirement (owner ruling 2026-08-23).';

COMMENT ON COLUMN vendor_engagement_assignments.assigned_to_participant_id IS
  'NULL = deliberately unassigned, with assignment_action saying why (cleared by '
  'the coordinator, or vacated when the assignee was revoked). A revoked '
  'participant''s work is NEVER auto-assigned to another human.';

COMMENT ON COLUMN vendor_engagement_assignments.superseded_at IS
  'NULL = the current assignment for this question. Exactly one such row exists '
  'per (organization, engagement, requirement), enforced by a partial unique index.';

-- ---------------------------------------------------------------
-- Integrity that spans tables
-- ---------------------------------------------------------------
--
-- Four facts have to agree, and three of them are ids a caller could supply:
--   the engagement belongs to the org and to the denormalised vendor;
--   the requirement is IN THAT ENGAGEMENT'S FROZEN ISSUED SCOPE — you cannot
--     delegate a question the vendor was never asked;
--   the assignee is a participant OF THIS ENGAGEMENT, not merely of this vendor.
--
-- The routes check all of this too. It lives here as well because a route is a
-- bad place for the only copy of an isolation rule, and because the bulk path
-- writes many rows at once, which is exactly where a missing predicate would
-- go unnoticed.

CREATE OR REPLACE FUNCTION vendor_engagement_assignments_verify_scope()
RETURNS TRIGGER AS $$
DECLARE
  engagement_vendor UUID;
  in_scope          INTEGER;
  assignee_engagement UUID;
BEGIN
  SELECT vendor_id INTO engagement_vendor
    FROM vendor_engagements
   WHERE id = NEW.engagement_id AND organization_id = NEW.organization_id;

  IF engagement_vendor IS NULL THEN
    RAISE EXCEPTION 'engagement % is not in organization %', NEW.engagement_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF engagement_vendor <> NEW.vendor_id THEN
    RAISE EXCEPTION 'assignment vendor % does not match engagement vendor %', NEW.vendor_id, engagement_vendor
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- The frozen scope is the authority on what may be delegated. `accepted_at`
  -- matters for the same reason it does everywhere else: an AI-suggested item
  -- nobody accepted is not a question the vendor was asked.
  SELECT COUNT(*) INTO in_scope
    FROM vendor_engagement_scope_items
   WHERE engagement_id = NEW.engagement_id
     AND organization_id = NEW.organization_id
     AND requirement_id = NEW.requirement_id
     AND (source = 'deterministic' OR accepted_at IS NOT NULL);

  IF in_scope = 0 THEN
    RAISE EXCEPTION 'requirement % is not in the issued scope of engagement %',
      NEW.requirement_id, NEW.engagement_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.assigned_to_participant_id IS NOT NULL THEN
    SELECT engagement_id INTO assignee_engagement
      FROM vendor_engagement_participants
     WHERE id = NEW.assigned_to_participant_id
       AND organization_id = NEW.organization_id;

    -- Belonging to the same VENDOR is not enough. A participant of the vendor's
    -- Q1 assessment must not be assignable into their Q2 assessment: that is the
    -- boundary neither the org predicate nor RLS can see.
    IF assignee_engagement IS NULL OR assignee_engagement <> NEW.engagement_id THEN
      RAISE EXCEPTION 'participant % is not a participant of engagement %',
        NEW.assigned_to_participant_id, NEW.engagement_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_engagement_assignments_verify_scope
  ON vendor_engagement_assignments;
CREATE TRIGGER trg_vendor_engagement_assignments_verify_scope
  BEFORE INSERT ON vendor_engagement_assignments
  FOR EACH ROW EXECUTE FUNCTION vendor_engagement_assignments_verify_scope();

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
-- NOT FORCE, matching the rest of the portal family: reads on this table happen
-- inside withTenant after the session resolver has established the org, but the
-- resolver family itself runs elevated, and keeping one posture across the
-- family is what makes the posture reviewable.

ALTER TABLE vendor_engagement_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_engagement_assignments_tenant_isolation
  ON vendor_engagement_assignments;
CREATE POLICY vendor_engagement_assignments_tenant_isolation
  ON vendor_engagement_assignments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_engagement_assignments TO app_request;
