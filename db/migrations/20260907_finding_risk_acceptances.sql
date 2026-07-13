-- 20260907_finding_risk_acceptances.sql
--
-- THE DURABLE RISK-ACCEPTANCE RECORD.
--
-- Product ruling (2026-07-12):
--   decision_state='accepted_risk'   = the explicit human governance decision.
--   operational_status='closed'      = no active remediation work remains, AFTER the
--                                      required risk-acceptance approval is complete.
--   The accepted exposure stays governed — closing the Finding must not remove
--   organizational visibility.
--
-- WHY THIS TABLE HAS TO EXIST
--
-- Before this migration there was NO durable, finding-scoped record of a risk-acceptance
-- decision anywhere in the platform:
--
--   * `risk_approvals` carries exactly the right fields (approver, rationale, expires_at,
--     decided_at, separation-of-duties CHECK) but is `risk_id NOT NULL` with no
--     polymorphic subject — it CANNOT approve a Finding.
--   * `finding_lifecycle_events` is genuinely append-only, but records no owner, no
--     rationale, no approver and no expiry. Its `comment` column is never populated by
--     any caller.
--   * `security_audit_log` is fire-and-forget with swallowed failures — an acceptance
--     recorded only there can be silently lost, so it cannot be the durable record.
--   * Nothing promotes a Finding onto the Risk Register, so closing an accepted-risk
--     Finding left the exposure carried by NOTHING.
--
-- Worse, the governance close path OVERWRITES decision_state='accepted_risk' with
-- 'resolved' (findingLifecycleMachine `close`), so the accepted-risk state could not even
-- survive its own closure. Accepting a risk therefore erased the fact that it had been
-- accepted.
--
-- THE PROMOTION SEED (architectural commitment, not built here)
--
-- The long-term canonical home for enduring accepted business risk is the Enterprise Risk
-- Register. Findings are OPERATIONAL WORK; the Register is ENDURING BUSINESS RISK. They
-- stay separate concepts. This package deliberately does NOT promote Findings into
-- `risks`. But this record is shaped to BECOME the authoritative promotion source without
-- a schema rewrite or a historical migration:
--
--   * `promoted_risk_id` is the forward hook — nullable, unused today, ready to carry the
--     Register linkage when promotion ships.
--   * owner / rationale / evidence / approver / approved_at / expires_at are exactly the
--     fields a `risks` row needs, captured at decision time rather than reconstructed
--     later from an audit trail that never held them.
--   * `governance_review_required` marks the legacy rows that must NOT be promoted until
--     a human supplies the missing approval evidence.
--
-- WORM
--
-- DELETE and TRUNCATE are forbidden outright. The decision CONTENT is immutable once the
-- record leaves 'proposed' — an approved acceptance's approver, rationale, and expiry can
-- never be rewritten. Only `state` may advance, and only along the legal transitions
-- below. This is write-once for the decision, with an auditable state machine on top.
--
--   proposed  → approved | rejected | withdrawn
--   approved  → expired  | withdrawn
--   legacy_unverified → approved | withdrawn      (after governance review)
--   rejected / expired / withdrawn are TERMINAL.
--
-- `finding_id` is ON DELETE RESTRICT, not CASCADE. `finding_lifecycle_events` uses CASCADE
-- and therefore loses its own "immutable" history when a finding is deleted; an acceptance
-- record is a governance artifact and must outlive any such attempt. (There is no
-- hard-delete route for findings today, so RESTRICT breaks nothing.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finding_risk_acceptances (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finding_id              UUID        NOT NULL REFERENCES findings(id) ON DELETE RESTRICT,

  state                   TEXT        NOT NULL DEFAULT 'proposed',

  -- Who is accountable for carrying this exposure. Required for a real acceptance;
  -- NULL only on legacy rows, where it was never captured and must not be invented.
  owner_user_id           UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  rationale               TEXT        NULL,

  requested_by_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  approver_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at             TIMESTAMPTZ NULL,
  decision_rationale      TEXT        NULL,

  -- The review / expiration date. An acceptance is a time-boxed decision, never a
  -- permanent pardon: past this date the acceptance stops closing the Finding.
  expires_at              DATE        NULL,

  withdrawn_at            TIMESTAMPTZ NULL,
  withdrawn_by_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  withdrawal_reason       TEXT        NULL,

  -- Legacy rows with no approval evidence. Closure is preserved (we do not reopen a
  -- customer's closed population), but the record is flagged for a human to complete.
  governance_review_required BOOLEAN  NOT NULL DEFAULT FALSE,

  -- FORWARD HOOK — the Enterprise Risk Register linkage. Unused in this package.
  promoted_risk_id        UUID        NULL REFERENCES risks(id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT finding_risk_acceptance_state_check CHECK (
    state IN ('proposed', 'approved', 'rejected', 'withdrawn', 'expired', 'legacy_unverified')
  ),

  -- Separation of duties: you cannot approve your own risk acceptance. Same rule
  -- risk_approvals already enforces (risk_approval_sod_check).
  CONSTRAINT finding_risk_acceptance_sod_check CHECK (
    approver_user_id IS NULL OR requested_by_user_id IS NULL
    OR approver_user_id <> requested_by_user_id
  ),

  -- A REAL proposal must name an owner, a rationale, and a requester. Anything less is
  -- not a governance decision.
  CONSTRAINT finding_risk_acceptance_proposal_complete CHECK (
    state <> 'proposed' OR (
      owner_user_id IS NOT NULL
      AND rationale IS NOT NULL AND length(btrim(rationale)) > 0
      AND requested_by_user_id IS NOT NULL
    )
  ),

  -- A REAL approval must additionally name an approver, when it was approved, and when
  -- it expires. An acceptance with no expiry is a permanent pardon, which is exactly the
  -- governance failure this object exists to prevent.
  CONSTRAINT finding_risk_acceptance_approval_complete CHECK (
    state <> 'approved' OR (
      owner_user_id IS NOT NULL
      AND rationale IS NOT NULL AND length(btrim(rationale)) > 0
      AND approver_user_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND expires_at IS NOT NULL
    )
  ),

  -- The legacy escape hatch is ONLY for legacy rows, and it must announce itself.
  CONSTRAINT finding_risk_acceptance_legacy_flagged CHECK (
    state <> 'legacy_unverified' OR governance_review_required = TRUE
  ),

  CONSTRAINT finding_risk_acceptance_withdrawal_complete CHECK (
    state <> 'withdrawn' OR withdrawn_at IS NOT NULL
  )
);

-- At most ONE live acceptance per finding. A finding cannot be simultaneously proposed
-- for acceptance twice, nor hold two approved acceptances. Terminal rows are unbounded —
-- the history of past acceptances is the audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS finding_risk_acceptances_one_live
  ON finding_risk_acceptances (finding_id)
  WHERE state IN ('proposed', 'approved', 'legacy_unverified');

CREATE INDEX IF NOT EXISTS finding_risk_acceptances_org_state
  ON finding_risk_acceptances (organization_id, state);

-- The review / expiration queue reads this.
CREATE INDEX IF NOT EXISTS finding_risk_acceptances_expiry
  ON finding_risk_acceptances (organization_id, expires_at)
  WHERE state = 'approved';

-- The governance-review queue (legacy rows awaiting a human) reads this.
CREATE INDEX IF NOT EXISTS finding_risk_acceptances_governance_review
  ON finding_risk_acceptances (organization_id)
  WHERE governance_review_required = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WORM: no deletes, no truncates, immutable decision content
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION finding_risk_acceptances_forbid_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'finding_risk_acceptances is append-only: % is forbidden. A risk acceptance is a governance artifact; withdraw it (state=''withdrawn'') instead of erasing it.',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finding_risk_acceptances_forbid_delete ON finding_risk_acceptances;
CREATE TRIGGER trg_finding_risk_acceptances_forbid_delete
  BEFORE DELETE ON finding_risk_acceptances
  FOR EACH ROW EXECUTE FUNCTION finding_risk_acceptances_forbid_delete();

DROP TRIGGER IF EXISTS trg_finding_risk_acceptances_forbid_truncate ON finding_risk_acceptances;
CREATE TRIGGER trg_finding_risk_acceptances_forbid_truncate
  BEFORE TRUNCATE ON finding_risk_acceptances
  FOR STATEMENT EXECUTE FUNCTION finding_risk_acceptances_forbid_delete();

/*
 * The decision content is write-once. Once a record leaves 'proposed' its identity,
 * subject, owner, rationale, approver, approval time and expiry are frozen forever — an
 * approved acceptance can never be quietly re-scoped, re-dated, or re-attributed.
 *
 * `state` may only advance along the legal transitions. `promoted_risk_id`, `updated_at`
 * and the withdrawal fields remain writable because they are set BY those transitions.
 */
CREATE OR REPLACE FUNCTION finding_risk_acceptances_enforce_worm()
RETURNS TRIGGER AS $$
BEGIN
  -- Immutable subject, always.
  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.finding_id <> OLD.finding_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'finding_risk_acceptances: id/organization_id/finding_id/created_at are immutable';
  END IF;

  -- Decision content freezes the moment the record stops being a proposal.
  IF OLD.state <> 'proposed' THEN
    IF NEW.owner_user_id        IS DISTINCT FROM OLD.owner_user_id
       OR NEW.rationale            IS DISTINCT FROM OLD.rationale
       OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
       OR NEW.approver_user_id     IS DISTINCT FROM OLD.approver_user_id
       OR NEW.approved_at          IS DISTINCT FROM OLD.approved_at
       OR NEW.decision_rationale   IS DISTINCT FROM OLD.decision_rationale
       OR NEW.expires_at           IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION
        'finding_risk_acceptances: the decision content of a % acceptance is immutable (WORM). Withdraw it and propose a new acceptance.',
        OLD.state;
    END IF;
  END IF;

  -- Legal state transitions only. Terminal states are terminal.
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

DROP TRIGGER IF EXISTS trg_finding_risk_acceptances_worm ON finding_risk_acceptances;
CREATE TRIGGER trg_finding_risk_acceptances_worm
  BEFORE UPDATE ON finding_risk_acceptances
  FOR EACH ROW EXECUTE FUNCTION finding_risk_acceptances_enforce_worm();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tenant isolation (RLS), matching the platform standard
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE finding_risk_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finding_risk_acceptances_tenant_isolation ON finding_risk_acceptances;
CREATE POLICY finding_risk_acceptances_tenant_isolation ON finding_risk_acceptances
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- SELECT/INSERT/UPDATE only. No DELETE grant — the WORM trigger is the hard stop, this is
-- the second lock. `state` advances by UPDATE, so UPDATE is required (unlike
-- finding_lifecycle_events, which is INSERT-only).
GRANT SELECT, INSERT, UPDATE ON finding_risk_acceptances TO app_request;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Evidence linkage — reuse the existing evidence primitive, no new store
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Evidence for an acceptance attaches as evidence.source_type='finding_risk_acceptance',
-- source_id=<acceptance id>. Additive: no change to how evidence works, one new subject.

ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_source_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_type_check
    CHECK (source_type IN (
      'control_test',
      'vendor_review',
      'ai_review',
      'obligation_review',
      'ai_governance_review',
      'dependency_review',
      'risk_treatment',
      'finding',
      'policy_review',
      'risk',
      'asset_assessment',
      'finding_risk_acceptance'
    ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. BACKFILL — preserve the closed population, fabricate nothing
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The legacy accepted population is ALREADY exactly the closed + accepted_risk
-- population: 20260829 backfilled status='accepted' → decision_state='accepted_risk',
-- and 20260906 backfilled it → operational_status='closed'.
--
-- Those rows carry NO approver, NO rationale, NO owner and NO expiry — there was never
-- anywhere to put them. Per the ruling: do not reopen them, do not fabricate the missing
-- data, and mark them for governance review.
--
-- So each becomes a `legacy_unverified` acceptance: it KEEPS the finding closed (the
-- customer's closed population does not move by a single row) and it is flagged so a
-- human can supply the approval evidence — or withdraw it, which will reopen the finding
-- through the normal path.
--
-- ON CONFLICT DO NOTHING makes this migration idempotent against the partial unique
-- index if it is ever re-run.

INSERT INTO finding_risk_acceptances (
  organization_id, finding_id, state, governance_review_required, created_at
)
SELECT f.organization_id,
       f.id,
       'legacy_unverified',
       TRUE,
       f.updated_at
  FROM findings f
 WHERE f.decision_state = 'accepted_risk'
   AND f.operational_status = 'closed'
   AND NOT EXISTS (
     SELECT 1 FROM finding_risk_acceptances a
      WHERE a.finding_id = f.id
        AND a.state IN ('proposed', 'approved', 'legacy_unverified')
   );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Lifecycle events — deliberately NOT widened
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The acceptance lifecycle does NOT get new `finding_lifecycle_events` transitions.
--
-- That stream records what happened to the FINDING's two axes, and its existing
-- vocabulary already says everything an acceptance causes: approving one drives
-- decision → 'accept_risk' and operational → 'operational_closed'; expiry or withdrawal
-- drives 'operational_reopened'. Its `finding_lifecycle_event_states_check` constrains
-- `to_state` per axis to the FINDING's states, so acceptance states ('proposed',
-- 'approved', …) could not legally be written there anyway.
--
-- The acceptance's OWN history lives in this table — which is append-only, holds the
-- decision content the event stream never could, and unlike finding_lifecycle_events is
-- not ON DELETE CASCADE. Plus security_audit_log for the actor trail. Widening an
-- existing WORM constraint to duplicate history we already store would be churn.

COMMENT ON TABLE finding_risk_acceptances IS
  'Durable, append-only record of a Finding risk-acceptance decision: owner, rationale, evidence, approver, approval timestamp, expiry. Closing an accepted-risk Finding does not erase the acceptance — this row carries it. Designed as the future Finding→Risk-Register promotion seed (promoted_risk_id).';
