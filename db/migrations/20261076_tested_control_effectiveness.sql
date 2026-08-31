-- Migration: tested_control_effectiveness
-- Package:   VA-S4-4C-3 — LAYER 2, governed effectiveness (slot 20261076)
--
-- What SECURELOGIC says about one tested control, on its own authority, decided
-- by a named human.
--
-- ── The vocabulary, and the value that is deliberately absent ──────────────
--
-- EFFECTIVE / INEFFECTIVE / INDETERMINATE.
--
-- Owner ruling: do NOT implement EFFECTIVE_WITH_EXCEPTION. Layer 2 is
-- ORTHOGONAL to exception state. A record may legitimately be EFFECTIVE while
-- an exception is separately PRESENT in Layer 3 (20261077), and those are two
-- facts read together — not one fused value that hides whichever half the
-- reader was not looking for. The moment a single column can say
-- "effective, but", the exception stops being independently queryable and the
-- governance record silently loses the ability to answer "what exceptions do we
-- carry".
--
-- Consequently NOTHING in this migration references, joins to, deletes from or
-- constrains against Layer 3. Accepting EFFECTIVE cannot erase an exception,
-- because it does not touch the table exceptions live in.
--
-- ── FAIL CLOSED, structurally ──────────────────────────────────────────────
--
-- Owner ruling: unknown or new situations must fail closed, and an unknown
-- outcome must never be silently classified as EFFECTIVE. Three properties make
-- that true by construction rather than by policy:
--
--   1. `governed_effectiveness` has NO DEFAULT. There is no value a row can
--      acquire without a writer stating it.
--   2. ABSENCE OF A ROW IS ABSENCE OF EFFECTIVENESS. No control has a governed
--      effectiveness until a human writes one. A reader that treats "no row" as
--      anything other than "not established" is wrong, and this comment is the
--      contract that says so.
--   3. INDETERMINATE MUST CARRY A REASON from a closed set, and the set has no
--      catch-all. An outcome that fits none of the four reasons cannot be
--      recorded at all — which leaves it visibly unaccepted instead of
--      absorbing it into a bucket that makes the gap unmeasurable.
--
-- ── The human authority requirement, and why it is a TRIGGER ───────────────
--
-- A governed effectiveness must name the person who decided it. The route
-- refuses an unattributed caller with a 403 before any write, but the route is
-- not the boundary: `requireApiKey` admits machine callers, and `scopeForApiKey`
-- resolves them to a full/admin seat, so an API key passes every capability
-- gate the seat model has. The capability answers "is this identity permitted";
-- it cannot answer "is this a human". Only an attributed actor can.
--
-- So the requirement is enforced here, in the database, and it is a TRIGGER
-- rather than a steady-state CHECK for the reason 20261071 already established:
-- `accepted_by_user_id` carries ON DELETE SET NULL, and a steady-state CHECK is
-- re-evaluated on the UPDATE that SET NULL performs — which would make deleting
-- a user who had accepted an effectiveness fail, turning a data-protection
-- operation into an error. The trigger fires only on INSERT, the moment the
-- decision is made, so historical rows and user deletion are unaffected while a
-- NEW unattributed acceptance is impossible.
--
-- ── accepted / rejected ────────────────────────────────────────────────────
--
-- Owner requirement: the reviewer may accept, EDIT, or REJECT a governed
-- interpretation. Edit is supersession — append a new decision, keep the old one
-- readable. Rejection is a decision in its own right: it withdraws the standing
-- governed answer and asserts no replacement, so a rejected row carries NO
-- effectiveness and NO reason. Fail-closed falls out of that: after a rejection
-- there is no live effectiveness, which reads as "not established", which is
-- correct.
--
-- Rollback: docs/release/ROLLBACK-20261076.sql
-- Additive, idempotent, re-runnable.

CREATE TABLE IF NOT EXISTS vendor_tested_control_effectiveness (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id              UUID        NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,
  extraction_id            UUID        NOT NULL REFERENCES vendor_assurance_extractions(id) ON DELETE CASCADE,
  element_key              TEXT        NOT NULL,

  decision                 TEXT        NOT NULL,

  -- LAYER 2. No DEFAULT, deliberately: nothing may acquire an effectiveness it
  -- was not given.
  governed_effectiveness   TEXT        NULL,
  indeterminate_reason     TEXT        NULL,

  -- THE HUMAN. ON DELETE SET NULL so erasure stays possible; the trigger below
  -- makes a NEW unattributed acceptance impossible without making deletion fail.
  accepted_by_user_id      UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  accepted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewer_note            TEXT        NULL,

  -- THE BASIS, snapshotted at the moment of the decision: the Layer-1 assertion
  -- as it then stood, the auditor's verbatim words, the advisory suggestion the
  -- reviewer was shown and whether they agreed with it, the document's approval
  -- state, and any prior decision this one supersedes. Same discipline as
  -- `assurance_opinion_basis` (20261070). Every input to this decision is
  -- mutable; the decision must stay explainable against what the reviewer
  -- actually saw.
  basis                    JSONB       NOT NULL DEFAULT '{}'::jsonb,

  superseded_at            TIMESTAMPTZ NULL,

  CONSTRAINT vendor_tested_control_effectiveness_decision_check
    CHECK (decision IN ('accepted', 'rejected')),

  CONSTRAINT vendor_tested_control_effectiveness_vocabulary_check
    CHECK (governed_effectiveness IS NULL
           OR governed_effectiveness IN ('EFFECTIVE', 'INEFFECTIVE', 'INDETERMINATE')),

  -- No catch-all. An outcome fitting none of these must be left unaccepted.
  CONSTRAINT vendor_tested_control_effectiveness_reason_vocabulary_check
    CHECK (indeterminate_reason IS NULL
           OR indeterminate_reason IN ('not_tested', 'not_applicable', 'scope_limited', 'design_only')),

  -- THE AUTHORITY SHAPE. An acceptance asserts an effectiveness; a rejection
  -- asserts none and must say why. There is no third shape, and in particular
  -- there is no shape in which a row exists with no decision and no value.
  CONSTRAINT vendor_tested_control_effectiveness_shape_check
    CHECK (
      (decision = 'accepted' AND governed_effectiveness IS NOT NULL)
      OR
      (decision = 'rejected' AND governed_effectiveness IS NULL
                             AND indeterminate_reason IS NULL
                             AND reviewer_note IS NOT NULL)
    ),

  -- A reason explains why effectiveness could NOT be established, so it belongs
  -- to INDETERMINATE and nowhere else. Required there, forbidden elsewhere:
  -- "we could not establish this" with no reason is indistinguishable from
  -- nobody having looked.
  CONSTRAINT vendor_tested_control_effectiveness_indeterminate_reason_check
    CHECK (
      (governed_effectiveness = 'INDETERMINATE' AND indeterminate_reason IS NOT NULL)
      OR
      (governed_effectiveness IS DISTINCT FROM 'INDETERMINATE' AND indeterminate_reason IS NULL)
    ),

  CONSTRAINT vendor_tested_control_effectiveness_element_key_nonempty
    CHECK (length(trim(element_key)) > 0)
);

-- One LIVE decision per (extraction, tested control).
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_tested_control_effectiveness_live
  ON vendor_tested_control_effectiveness (extraction_id, element_key)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_tested_control_effectiveness_document
  ON vendor_tested_control_effectiveness (organization_id, document_id, accepted_at DESC);

-- ── The human-authority trigger ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vendor_assurance_require_human_effectiveness()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.accepted_by_user_id IS NULL THEN
    RAISE EXCEPTION
      'governed effectiveness for tested control % has no attributed human reviewer', NEW.element_key
      USING ERRCODE = '23514',
            HINT = 'Governed control effectiveness is a human determination and must name the '
                   'person who made it. Decide as an authenticated user; an API key alone '
                   'establishes permission, never human authority.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION vendor_assurance_require_human_effectiveness() IS
  'VA-S4-4C-3. Makes an unattributed governed effectiveness impossible at the '
  'database layer. INSERT-only, following 20261071: accepted_by_user_id carries '
  'ON DELETE SET NULL and a steady-state CHECK would make deleting a user who '
  'had decided an effectiveness fail.';

DROP TRIGGER IF EXISTS trg_vendor_assurance_require_human_effectiveness
  ON vendor_tested_control_effectiveness;

CREATE TRIGGER trg_vendor_assurance_require_human_effectiveness
  BEFORE INSERT ON vendor_tested_control_effectiveness
  FOR EACH ROW
  EXECUTE FUNCTION vendor_assurance_require_human_effectiveness();

ALTER TABLE vendor_tested_control_effectiveness ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_tested_control_effectiveness_tenant_isolation
  ON vendor_tested_control_effectiveness;
CREATE POLICY vendor_tested_control_effectiveness_tenant_isolation
  ON vendor_tested_control_effectiveness
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_tested_control_effectiveness TO app_request;
  END IF;
END
$$;

COMMENT ON TABLE vendor_tested_control_effectiveness IS
  'VA-S4-4C-3 LAYER 2. SecureLogic-GOVERNED effectiveness of one vendor tested '
  'control, decided by a NAMED HUMAN. EFFECTIVE / INEFFECTIVE / INDETERMINATE. '
  'ORTHOGONAL to exception state — there is deliberately no '
  'EFFECTIVE_WITH_EXCEPTION, and accepting EFFECTIVE neither touches nor erases '
  'any Layer-3 exception. ABSENCE OF A ROW IS ABSENCE OF EFFECTIVENESS, never '
  'effectiveness. Establishes NO requirement coverage and reduces NO '
  'questionnaire depth. Append-only: superseded, never mutated.';

COMMENT ON COLUMN vendor_tested_control_effectiveness.governed_effectiveness IS
  'No DEFAULT, deliberately. Nothing acquires an effectiveness a writer did not '
  'state, and no unknown or unrecognised outcome can become EFFECTIVE by '
  'omission. NULL only on a rejection, which asserts no effectiveness at all.';

COMMENT ON COLUMN vendor_tested_control_effectiveness.basis IS
  'The decision basis snapshotted at acceptance: the Layer-1 assertion as it '
  'then stood, the auditor''s verbatim result, the advisory suggestion shown to '
  'the reviewer and whether they agreed, the document approval state, and any '
  'superseded prior decision. Every input is mutable; the decision must stay '
  'explainable against what the reviewer actually saw.';
