-- Migration: orchestration_playbooks (ERIP E6b — playbook framework + scheduling)
-- Package: Enterprise Risk Intelligence Platform — Autonomous Operations
-- Design authority: raised-bar directive 2026-07-06 (playbook framework +
-- scheduling). Human approval is preserved: a playbook run creates PROPOSALS
-- (status 'proposed'), each of which still requires a different human to
-- approve before its executor runs (ERIP-AD-24/25).
--
--   steps     — ordered array of proposal templates:
--               [{ "proposal_type": ..., "title": ..., "payload": {...} }].
--               JSONB is correct here (a template, not a domain object); each
--               step is validated against orchestrationPolicy at run time.
--   schedule_interval_minutes — NULL = manual-run-only; else the cadence at
--               which the scheduler instantiates the playbook.
--   next_run_at — when the scheduler may next instantiate; NULL = due now.
--   enabled   — the playbook activation control.
--
-- Tenant model: NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML. Additive only. Dark behind
-- SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED.
--
-- Rollback (manual, forward-only): DROP TABLE orchestration_playbooks.

CREATE TABLE IF NOT EXISTS orchestration_playbooks (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                      TEXT        NOT NULL,
  steps                     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  schedule_interval_minutes INTEGER     NULL CHECK (schedule_interval_minutes IS NULL OR schedule_interval_minutes >= 60),
  next_run_at               TIMESTAMPTZ NULL,
  enabled                   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  last_run_at               TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_playbooks_org
  ON orchestration_playbooks (organization_id);

CREATE INDEX IF NOT EXISTS idx_orchestration_playbooks_due
  ON orchestration_playbooks (next_run_at)
  WHERE enabled AND schedule_interval_minutes IS NOT NULL;

ALTER TABLE orchestration_playbooks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'orchestration_playbooks'
       AND policyname = 'orchestration_playbooks_tenant_isolation'
  ) THEN
    CREATE POLICY orchestration_playbooks_tenant_isolation ON orchestration_playbooks
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON orchestration_playbooks TO app_request;
