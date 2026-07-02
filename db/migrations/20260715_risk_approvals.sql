-- ============================================================
-- 20260715_risk_approvals.sql — Risk lifecycle (Epic R1 scaffold, R2 executes)
--
-- The approval record for the executive-approval gate. This SUBSUMES RR-8
-- (risk acceptance workflow): RR-8's acceptance_rationale / acceptance_approver
-- / acceptance_expires_at map to request_rationale + decision_rationale /
-- approver_user_id / expires_at with kind='risk_acceptance'. See
-- docs/specs/risk-lifecycle-spec.md §7.3 and the RR-8 subsume note in
-- docs/RISK_REGISTER_ROADMAP.md.
--
-- R1 ships the SCHEMA ONLY (no rows are created in R1 — approval request and
-- decision endpoints are Epic R2). Separation of duties is enforced at the DB
-- level here (approver_user_id <> requested_by_user_id).
--
-- Ships with inert RLS scaffolding (20260715_risk_approvals_rls.sql).
-- organization_id NOT NULL. Additive; idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_approvals (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_id              UUID        NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  treatment_id         UUID        NULL REFERENCES risk_treatments(id) ON DELETE SET NULL,
  kind                 TEXT        NOT NULL,
  decision             TEXT        NOT NULL DEFAULT 'pending',
  requested_by_user_id UUID        NOT NULL REFERENCES users(id),
  approver_user_id     UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  request_rationale    TEXT        NULL,
  decision_rationale   TEXT        NULL,
  expires_at           DATE        NULL,
  decided_at           TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT risk_approval_kind_check     CHECK (kind IN ('treatment_plan', 'risk_acceptance')),
  CONSTRAINT risk_approval_decision_check CHECK (decision IN ('pending', 'approved', 'rejected')),
  -- Separation of duties: an approver, once set, may never be the requester.
  CONSTRAINT risk_approval_sod_check      CHECK (
    approver_user_id IS NULL OR approver_user_id <> requested_by_user_id
  )
);

-- At most one OPEN (pending) approval per risk.
CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_approvals_one_open
  ON risk_approvals (organization_id, risk_id)
  WHERE decision = 'pending';

-- Org-wide pending-approvals queue support.
CREATE INDEX IF NOT EXISTS idx_risk_approvals_org_pending
  ON risk_approvals (organization_id, decision, created_at DESC);

COMMENT ON TABLE risk_approvals IS
  'Executive-approval records for the risk lifecycle (Epic R2). Subsumes RR-8. '
  'SoD enforced by risk_approval_sod_check. See docs/specs/risk-lifecycle-spec.md.';
