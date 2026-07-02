-- ============================================================
-- 20260714_risk_lifecycle_events.sql — Risk lifecycle (Epic R1)
--
-- The append-only, per-risk lifecycle event stream. Every successful state
-- transition writes exactly one row here, INSIDE the same tenant transaction
-- as the risks.lifecycle_state UPDATE (atomicity is the point — this is the
-- deliberate improvement over the fire-and-forget security_audit_log
-- projection; see docs/specs/risk-lifecycle-spec.md §7.2 and the RR-3
-- supersede note in docs/RISK_REGISTER_ROADMAP.md).
--
-- Immutability is enforced by 20260714_risk_lifecycle_events_immutable.sql
-- (append-only triggers, same pattern as security_audit_log). RLS is enabled
-- by 20260714_risk_lifecycle_events_rls.sql.
--
-- approval_id is FK-in-spirit only (no hard FK) so this table can be created a
-- day before risk_approvals (20260715) without an ordering dependency.
--
-- organization_id is NOT NULL (tenant-scoped). Additive; idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_lifecycle_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_id          UUID        NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  from_state       TEXT        NULL,
  to_state         TEXT        NOT NULL,
  transition       TEXT        NOT NULL,
  actor_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_api_key_id UUID        NULL,
  comment          TEXT        NULL,
  evidence_ids     UUID[]      NOT NULL DEFAULT '{}',
  approval_id      UUID        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT risk_lifecycle_event_to_state_check CHECK (
    to_state IN (
      'draft','scoping','treatment_selection','pending_approval','mitigation',
      'validation','residual_review','closed','archived'
    )
  ),
  CONSTRAINT risk_lifecycle_event_from_state_check CHECK (
    from_state IS NULL OR from_state IN (
      'draft','scoping','treatment_selection','pending_approval','mitigation',
      'validation','residual_review','closed','archived'
    )
  ),
  CONSTRAINT risk_lifecycle_event_transition_check CHECK (
    transition IN (
      'begin_assessment','advance_to_treatment','submit_for_approval',
      'start_mitigation_direct','approve','reject','complete_mitigation',
      'pass_validation','fail_validation','close','reopen','archive',
      'unarchive','rescore'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_rle_org_risk_created
  ON risk_lifecycle_events (organization_id, risk_id, created_at DESC, id DESC);
