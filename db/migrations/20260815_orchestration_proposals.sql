-- Migration: orchestration_proposals (ERIP Epic 6, Autonomous Operations)
-- Package: Enterprise Risk Intelligence Platform — Epic 6
-- Design authority: docs/architecture/erip/E6-AUTONOMOUS-OPERATIONS-MEMO.md
--
-- The approval-gated orchestration ledger (ERIP-AD-24/26): each row is a
-- PROPOSED operational action that is inert until a DIFFERENT human approves
-- it (SoD, ERIP-AD-25). Status moves only FORWARD:
--   proposed → approved → executed | failed
--   proposed → rejected
--
--   proposal_type       — what the proposal would do. Phase-1 admits only
--                         'create_action' (emit an actions row on approval,
--                         ERIP-AD-27). Extended via migration as executors land.
--   payload             — the executor input (validated per type in the pure
--                         orchestrationPolicy before insert). NOT compliance-
--                         load-bearing (it is executor config, not a domain
--                         object) — freeform JSONB is appropriate here.
--   proposed_by_user_id — the human who proposed (SoD proposer).
--   approved_by_user_id — the DIFFERENT human who approved (NULL until then).
--   execution_result    — the executor's outcome (e.g. { action_id } or error).
--
-- Tenant model: standard NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML — the 20260807 pattern. Additive only.
-- All routes are dark behind SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED.
--
-- Rollback (manual, forward-only convention): DROP TABLE orchestration_proposals
-- — self-contained (no inbound FKs; created actions reference nothing back).

CREATE TABLE IF NOT EXISTS orchestration_proposals (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposal_type        TEXT        NOT NULL CHECK (proposal_type IN ('create_action')),
  title                TEXT        NOT NULL,
  payload              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status               TEXT        NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed', 'approved', 'rejected', 'executed', 'failed')),
  proposed_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  execution_result     JSONB       NULL,
  executed_at          TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_proposals_org_status
  ON orchestration_proposals (organization_id, status);

ALTER TABLE orchestration_proposals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'orchestration_proposals'
       AND policyname = 'orchestration_proposals_tenant_isolation'
  ) THEN
    CREATE POLICY orchestration_proposals_tenant_isolation ON orchestration_proposals
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON orchestration_proposals TO app_request;
