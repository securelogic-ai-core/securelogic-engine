-- 20261031_finding_risk_exceptions.sql
--
-- Risk EXCEPTION, distinguished from risk ACCEPTANCE (SL-EXC-1).
--
-- ── THE FALSE STATE THIS CORRECTS ──────────────────────────────────────────
-- findingLifecycleMachine derives `operational_status = 'closed'` from a
-- binding acceptance, and the machine's own comment says why:
--
--     "Accepting a risk is a decision that no remediation work remains."
--
-- That is right for an ACCEPTANCE and wrong for an EXCEPTION. An exception is
-- the opposite statement: the work is still required, still outstanding, and
-- has been formally authorised to run late. Recording one through the
-- acceptance path made the platform assert that remediation was DONE the
-- moment an exception was approved — a finding that closes because someone
-- said they could not fix it in time. An auditor reading that record would be
-- told the opposite of the truth, and the customer's own overdue population
-- would quietly shrink every time they granted an extension.
--
-- ── ONE TABLE, NOT TWO ─────────────────────────────────────────────────────
-- The workflow either decision needs is identical: a request with a
-- justification, separation-of-duties approval, an expiry, a WORM record and
-- an audit trail. finding_risk_acceptances already implements all of it,
-- correctly, with an immutability trigger and a DB-level SoD CHECK. Building a
-- second table would duplicate that machinery and, more importantly, duplicate
-- the ONE definition of "binding" that findingLifecycle and riskAcceptance both
-- import — the exact drift riskAcceptanceContract.ts exists to prevent.
--
-- So `kind` discriminates, and the binding predicate becomes kind-aware in that
-- single shared definition. Customer-visible semantics stay distinct; the
-- plumbing is shared.
--
-- ── WHY DEFAULT 'acceptance' ───────────────────────────────────────────────
-- Every existing row was created through the acceptance workflow and closes its
-- finding today. Defaulting to 'acceptance' means no historical closure changes
-- meaning and no customer's closed population moves. An exception can only
-- exist because someone explicitly asked for one.

ALTER TABLE finding_risk_acceptances
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'acceptance';

ALTER TABLE finding_risk_acceptances
  DROP CONSTRAINT IF EXISTS finding_risk_acceptance_kind_check;
ALTER TABLE finding_risk_acceptances
  ADD CONSTRAINT finding_risk_acceptance_kind_check
  CHECK (kind IN ('acceptance', 'exception'));

COMMENT ON COLUMN finding_risk_acceptances.kind IS
  '''acceptance'' = the organisation accepts the risk; remediation is finished and the finding CLOSES. ''exception'' = the organisation authorises a temporary deviation; remediation remains OUTSTANDING and the finding stays OPEN. The distinction is enforced in SQL_ACCEPTANCE_BINDING (riskAcceptanceContract.ts), which only treats an acceptance as closing.';

-- ── What was authorised, and what it was authorised against ────────────────
--
-- compensating_control: what reduces the exposure while the deviation stands.
-- An exception with no compensating control is a legitimate decision, so this
-- is nullable — but an unanswered field is very different from an unasked one,
-- and reporting can now tell them apart.
--
-- sla_due_date_at_request: the finding's due date AT THE MOMENT the request was
-- made, frozen here. This is the whole point of the package. An approved
-- exception must never rewrite the original obligation: an auditor has to be
-- able to see that the remediation requirement was NOT met on time AND that
-- the continued exposure was formally authorised. Those are two facts, and
-- overwriting findings.due_date would destroy the first to record the second.
-- findings.due_date is deliberately left untouched by the whole exception path.
ALTER TABLE finding_risk_acceptances
  ADD COLUMN IF NOT EXISTS compensating_control    TEXT,
  ADD COLUMN IF NOT EXISTS sla_due_date_at_request DATE;

COMMENT ON COLUMN finding_risk_acceptances.sla_due_date_at_request IS
  'The finding''s remediation due date when the exception was requested, frozen. The original obligation is never rewritten by an exception — reporting needs BOTH "the SLA was missed" and "the exposure was authorised".';

-- ── One live record per KIND, not per finding ──────────────────────────────
--
-- The old index allowed one live row per finding full stop, which would have
-- made an exception and an acceptance mutually exclusive. They are different
-- decisions and can legitimately coexist in sequence (an exception runs out,
-- the organisation then accepts the risk) — and nothing should force a customer
-- to withdraw one to record the other.
DROP INDEX IF EXISTS finding_risk_acceptances_one_live;
CREATE UNIQUE INDEX IF NOT EXISTS finding_risk_acceptances_one_live_per_kind
  ON finding_risk_acceptances (finding_id, kind)
  WHERE state IN ('proposed', 'approved', 'legacy_unverified');

-- The expiry sweep reads this; kind is included so the exception and acceptance
-- populations can be swept and reported separately without a second index.
CREATE INDEX IF NOT EXISTS finding_risk_acceptances_kind_expiry
  ON finding_risk_acceptances (organization_id, kind, expires_at)
  WHERE state = 'approved';

-- ── WORM: the new decision content freezes with the rest ───────────────────
--
-- kind, the compensating control and the frozen SLA date are DECISION CONTENT,
-- not bookkeeping. An approved exception whose kind could later be flipped to
-- 'acceptance' would close its finding retroactively; one whose compensating
-- control could be edited after sign-off would let the justification be
-- rewritten after the fact. Both belong inside the freeze.
CREATE OR REPLACE FUNCTION finding_risk_acceptances_enforce_worm()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.finding_id <> OLD.finding_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'finding_risk_acceptances: id/organization_id/finding_id/created_at are immutable';
  END IF;

  -- kind is immutable from the moment the record exists, not merely from
  -- approval: a proposal for an exception must never become a proposal for an
  -- acceptance under an approver who thought they were signing the former.
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'finding_risk_acceptances: kind is immutable — withdraw and raise the other kind instead';
  END IF;

  IF OLD.state <> 'proposed' THEN
    IF NEW.owner_user_id           IS DISTINCT FROM OLD.owner_user_id
       OR NEW.rationale               IS DISTINCT FROM OLD.rationale
       OR NEW.requested_by_user_id    IS DISTINCT FROM OLD.requested_by_user_id
       OR NEW.approver_user_id        IS DISTINCT FROM OLD.approver_user_id
       OR NEW.approved_at             IS DISTINCT FROM OLD.approved_at
       OR NEW.decision_rationale      IS DISTINCT FROM OLD.decision_rationale
       OR NEW.expires_at              IS DISTINCT FROM OLD.expires_at
       OR NEW.compensating_control    IS DISTINCT FROM OLD.compensating_control
       OR NEW.sla_due_date_at_request IS DISTINCT FROM OLD.sla_due_date_at_request THEN
      RAISE EXCEPTION
        'finding_risk_acceptances: the decision content of a % record is immutable (WORM). Withdraw it and raise a new one.',
        OLD.state;
    END IF;
  END IF;

  IF NEW.state <> OLD.state THEN
    IF NOT (
      (OLD.state = 'proposed'          AND NEW.state IN ('approved', 'rejected', 'withdrawn'))
      OR (OLD.state = 'approved'          AND NEW.state IN ('expired', 'withdrawn'))
      OR (OLD.state = 'legacy_unverified' AND NEW.state IN ('approved', 'withdrawn'))
    ) THEN
      RAISE EXCEPTION 'finding_risk_acceptances: illegal state transition % → %', OLD.state, NEW.state;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
