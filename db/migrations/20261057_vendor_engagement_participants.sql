-- Migration: vendor_engagement_participants
-- Package:   Vendor Assurance — VA-P1 (multi-responder participation)
--
-- MORE THAN ONE PERSON AT THE SUPPLIER CAN WORK ON THE SAME QUESTIONNAIRE.
--
-- Until now an engagement had exactly ONE credential. `issue` minted an invite,
-- `reissue` revoked every live invite before minting the next ("single-active
-- -invite rule"), and a session was anonymous link-sharing: whoever held the URL
-- was the vendor. A supplier whose security lead answers the security section
-- and whose counsel answers the privacy section had one option — forward the
-- link — which put one credential in several mailboxes, made every answer
-- attributable to the same anonymous token, and meant revoking one person
-- revoked everybody.
--
-- ── Participant is not Contact ─────────────────────────────────────────────
--
-- VA-C1's `vendor_contacts` is the supplier's DIRECTORY: people we know at that
-- company, a standing relationship fact. Taking part in ONE assessment is not.
-- This table is the participation record and it POINTS AT the contact — it does
-- not copy them. Removing somebody from a questionnaire must never delete them
-- from the directory, and editing a contact must never rewrite an engagement's
-- history.
--
--   vendor_contacts                  who we know at the supplier
--   vendor_engagement_participants   who may work on THIS assessment
--   vendor_engagement_invites        the credential one participant was sent
--   vendor_portal_sessions           one browser, one participant, one engagement
--
-- ── Attribution needs NO new columns, and that is the point ────────────────
--
-- Every portal-authored artifact already records `*_via_invite_id`:
-- requirement_responses.answered_via_invite_id (20260924),
-- requirement_response_revisions.answered_via_invite_id (20260924),
-- evidence.uploaded_via_invite_id and vendor_engagement_comments
-- .authored_via_invite_id (20260925). Those columns were the honest answer to
-- "a vendor has no user id" and they are already immutable history.
--
-- Once an invite belongs to a PARTICIPANT, every one of those existing columns
-- resolves to a person: artifact -> invite -> participant -> contact. So VA-P1
-- adds person-level attribution to answers, revisions, evidence and comments
-- WITHOUT touching four tables, without a backfill, and without a second place
-- where authorship could disagree with itself. The link is immutable in the
-- direction that matters: an invite's participant_id is written once at mint
-- and never re-pointed, so later edits to a contact's name or address cannot
-- rewrite who authored what.
--
-- ── The single-active-invite rule becomes PER PARTICIPANT ──────────────────
--
-- It was a security property, not an accident: one live credential per
-- engagement meant a superseded link died. Per participant it keeps exactly the
-- same force — re-issuing to Jane kills Jane's old link and Jane's live
-- sessions, and leaves Robert working. Enforced by a partial unique index here
-- rather than by remembering to write the right WHERE clause at three call
-- sites.
--
-- ── Roles: two, deliberately ───────────────────────────────────────────────
--
-- No RBAC system. `coordinator` is the person the customer sent the assessment
-- to: they may invite and revoke teammates, and they alone may submit.
-- `contributor` answers questions and attaches evidence. Anything finer is
-- VA-D1's problem (question and section assignment), and inventing permissions
-- now would mean inventing them twice.
--
-- NOTE ON `is_primary_contact`: VA-C1 deliberately refused to call that field
-- "primary respondent" because the standing primary contact at a supplier and
-- the coordinator of one assessment are different facts. This table is where
-- the second one lives. They are not synced and must not be.
--
-- Additive only. Empty at birth. RLS lands with the table.

CREATE TABLE IF NOT EXISTS vendor_engagement_participants (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Denormalised from the engagement for the same reason vendor_portal_sessions
  -- denormalises engagement_id: the isolation predicate is needed on EVERY
  -- lookup, and a join to reach it on an externally-reachable path is a place
  -- for a mistake to hide. Kept honest by vendor_engagement_participants_vendor_matches.
  vendor_id                 UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  engagement_id             UUID        NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  -- The PERSON. RESTRICT, not CASCADE and not SET NULL: a participant with no
  -- contact would be an anonymous credential holder, which is the thing this
  -- package exists to remove. VA-C1's DELETE route already refuses to remove a
  -- contact any invite references; this extends the same refusal to
  -- participation, and deactivating the contact remains the intended path.
  contact_id                UUID        NOT NULL REFERENCES vendor_contacts(id) ON DELETE RESTRICT,

  participant_role          TEXT        NOT NULL DEFAULT 'contributor'
                              CHECK (participant_role IN ('coordinator', 'contributor')),

  -- invited  — a credential exists, nobody has used it yet
  -- active   — the invitation has been exchanged for a session at least once
  -- revoked  — access withdrawn; the row and everything it authored REMAIN
  status                    TEXT        NOT NULL DEFAULT 'invited'
                              CHECK (status IN ('invited', 'active', 'revoked')),

  -- WHO brought this person in. At most one, never both: "the supplier chose to
  -- bring their counsel in" and "we sent it to their counsel" are different
  -- facts about the same row and must not be claimed simultaneously.
  --
  -- BOTH NULL is legal and means "added customer-side by an API-key caller",
  -- which has no user behind it. That is the platform's existing reality —
  -- created_by_user_id is nullable on vendor_engagement_invites, vendor_contacts
  -- and everywhere else for exactly this reason. An earlier draft of this
  -- constraint demanded exactly one and made every API-key integration a 23514.
  -- The vendor-side path is attributed unconditionally: the portal route refuses
  -- to add anyone unless the caller has a participant row of their own.
  invited_by_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  invited_by_participant_id UUID        NULL REFERENCES vendor_engagement_participants(id) ON DELETE SET NULL,

  first_accepted_at         TIMESTAMPTZ NULL,
  last_accepted_at          TIMESTAMPTZ NULL,

  revoked_at                TIMESTAMPTZ NULL,
  revoked_by_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  revoked_by_participant_id UUID        NULL REFERENCES vendor_engagement_participants(id) ON DELETE SET NULL,
  revocation_reason         TEXT        NULL,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- status and revoked_at are one fact written two ways; the same
  -- closed <=> closed_at discipline T2-I used on pen_test_engagements.
  CONSTRAINT vendor_engagement_participants_revoked_consistency CHECK (
    (status = 'revoked') = (revoked_at IS NOT NULL)
  ),
  CONSTRAINT vendor_engagement_participants_revocation_reason CHECK (
    revoked_at IS NULL OR (revocation_reason IS NOT NULL AND length(trim(revocation_reason)) > 0)
  ),
  CONSTRAINT vendor_engagement_participants_one_inviter CHECK (
    NOT (invited_by_user_id IS NOT NULL AND invited_by_participant_id IS NOT NULL)
  ),
  -- 'active' means the credential has actually been exchanged. Without this the
  -- status column could claim participation that never happened.
  CONSTRAINT vendor_engagement_participants_active_accepted CHECK (
    status <> 'active' OR first_accepted_at IS NOT NULL
  )
);

-- One participation row per person per engagement. Re-inviting somebody who is
-- already on the engagement must re-use their row (and mint a fresh credential),
-- never create a second identity for the same human — two rows would mean two
-- sets of attribution for one person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_engagement_participants_identity
  ON vendor_engagement_participants (organization_id, engagement_id, contact_id);

-- Exactly one live coordinator per engagement. Among non-revoked rows only, so
-- a revoked coordinator never blocks naming their successor — the same shape as
-- VA-C1's active-only primary-contact index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_engagement_participants_coordinator
  ON vendor_engagement_participants (organization_id, engagement_id)
  WHERE participant_role = 'coordinator' AND status <> 'revoked';

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_participants_engagement
  ON vendor_engagement_participants (organization_id, engagement_id, status);

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_participants_contact
  ON vendor_engagement_participants (contact_id);

COMMENT ON TABLE vendor_engagement_participants IS
  'Who may work on ONE vendor assessment. Points at vendor_contacts (VA-C1) — '
  'the supplier directory — and never copies it: removing somebody from a '
  'questionnaire must not delete them from the directory. Participation is per '
  'engagement; being a contact at the supplier is not participation.';

COMMENT ON COLUMN vendor_engagement_participants.participant_role IS
  'coordinator = the recipient the customer addressed the assessment to; may '
  'invite/revoke teammates and is the ONLY role that may submit. contributor = '
  'answers and attaches evidence. Not RBAC — question/section assignment is VA-D1.';

COMMENT ON COLUMN vendor_engagement_participants.status IS
  'invited -> active on first credential exchange; revoked withdraws access '
  'while every answer, revision, file, comment and audit row it authored REMAINS.';

-- ---------------------------------------------------------------
-- The invite learns which participant it is a credential for
-- ---------------------------------------------------------------
--
-- Nullable, because every invite issued before VA-P1 was addressed to a typed
-- string or a bare contact with no participation record, and there is no honest
-- way to invent the participant behind it. SET NULL on delete for the same
-- reason contact_id is: losing the link must never rewrite the historical
-- record of who was invited, which contact_email/contact_name preserve.
--
-- This column is what turns the four EXISTING `*_via_invite_id` provenance
-- columns into person-level attribution. It is written once at mint and never
-- re-pointed.

ALTER TABLE vendor_engagement_invites
  ADD COLUMN IF NOT EXISTS participant_id UUID NULL
    REFERENCES vendor_engagement_participants(id) ON DELETE SET NULL;

-- The single-active-invite rule, now PER PARTICIPANT and enforced by the
-- database instead of by three call sites remembering the same WHERE clause.
-- Partial on revoked_at IS NULL so history accumulates freely underneath.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_engagement_invites_live_participant
  ON vendor_engagement_invites (participant_id)
  WHERE participant_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_invites_participant
  ON vendor_engagement_invites (participant_id)
  WHERE participant_id IS NOT NULL;

COMMENT ON COLUMN vendor_engagement_invites.participant_id IS
  'The participation record this credential belongs to. NULL for invites minted '
  'before VA-P1. Written once and never re-pointed: it is what makes '
  'requirement_responses.answered_via_invite_id, evidence.uploaded_via_invite_id '
  'and vendor_engagement_comments.authored_via_invite_id resolve to a PERSON.';

-- ---------------------------------------------------------------
-- Integrity that spans tables
-- ---------------------------------------------------------------
--
-- The denormalised vendor_id must be the engagement's vendor, and the contact
-- must belong to that same vendor. Without this a participant row could name
-- Vendor A's engagement and Vendor B's contact, and every downstream check that
-- trusts one column to imply the other would be wrong. A trigger rather than a
-- CHECK because the facts live in other tables.

CREATE OR REPLACE FUNCTION vendor_engagement_participants_verify_scope()
RETURNS TRIGGER AS $$
DECLARE
  engagement_vendor UUID;
  contact_vendor    UUID;
  contact_org       UUID;
BEGIN
  SELECT vendor_id INTO engagement_vendor
    FROM vendor_engagements
   WHERE id = NEW.engagement_id AND organization_id = NEW.organization_id;

  IF engagement_vendor IS NULL THEN
    RAISE EXCEPTION 'engagement % is not in organization %', NEW.engagement_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF engagement_vendor <> NEW.vendor_id THEN
    RAISE EXCEPTION 'participant vendor % does not match engagement vendor %', NEW.vendor_id, engagement_vendor
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT vendor_id, organization_id INTO contact_vendor, contact_org
    FROM vendor_contacts
   WHERE id = NEW.contact_id;

  IF contact_vendor IS NULL OR contact_org <> NEW.organization_id OR contact_vendor <> NEW.vendor_id THEN
    RAISE EXCEPTION 'contact % does not belong to vendor % in organization %',
      NEW.contact_id, NEW.vendor_id, NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_engagement_participants_verify_scope
  ON vendor_engagement_participants;
CREATE TRIGGER trg_vendor_engagement_participants_verify_scope
  BEFORE INSERT OR UPDATE OF organization_id, vendor_id, engagement_id, contact_id
  ON vendor_engagement_participants
  FOR EACH ROW EXECUTE FUNCTION vendor_engagement_participants_verify_scope();

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
-- NOT FORCE, matching vendor_engagement_invites and vendor_portal_sessions:
-- the portal session resolver reads this table BEFORE org context exists — the
-- lookup is what establishes the org — so it necessarily runs on the elevated
-- channel. Everything after resolution runs inside withTenant(orgId).

ALTER TABLE vendor_engagement_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_engagement_participants_tenant_isolation
  ON vendor_engagement_participants;
CREATE POLICY vendor_engagement_participants_tenant_isolation
  ON vendor_engagement_participants
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_engagement_participants TO app_request;
