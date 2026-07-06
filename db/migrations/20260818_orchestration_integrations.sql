-- Migration: orchestration integrations + widen proposal types (ERIP E6a)
-- Package: Enterprise Risk Intelligence Platform — Autonomous Operations executors
-- Design authority: raised-bar directive 2026-07-06 (real ServiceNow/Jira/Email/
-- Teams/Slack executors + evidence/escalation). Human approval unchanged
-- (ERIP-AD-24/25/26): executors run only AFTER a different human approves.
--
-- 1. orchestration_integrations — per-org, per-channel outbound configuration
--    (the enterprise_connectors 20260807 pattern). config_encrypted holds the
--    channel's credentials/endpoint, AES-256-GCM-encrypted at the app layer
--    (fieldEncryption); routes echo config KEYS only, never values. `enabled`
--    is the per-integration activation control. Secrets excluded from exports.
--
-- 2. Widen orchestration_proposals.proposal_type to admit the new executors.
--    Widening-only DROP+ADD of the CHECK (the 20260813 reshape pattern) — every
--    prior value ('create_action') is retained; no row is invalidated.
--
-- Tenant model: NULLIF-GUC RLS (enabled, NOT FORCE) + denormalized
-- organization_id + app_request DML. Additive only. All dark behind
-- SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED; per-integration enabled row toggle.
--
-- Rollback (manual, forward-only): DROP TABLE orchestration_integrations; then
-- re-add the prior single-value proposal_type CHECK.

CREATE TABLE IF NOT EXISTS orchestration_integrations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id    TEXT        NOT NULL CHECK (integration_id IN (
                                  'servicenow', 'jira', 'teams', 'slack', 'email')),
  config_encrypted  TEXT        NOT NULL,
  enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, integration_id)
);

CREATE INDEX IF NOT EXISTS idx_orchestration_integrations_org
  ON orchestration_integrations (organization_id);

ALTER TABLE orchestration_integrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'orchestration_integrations'
       AND policyname = 'orchestration_integrations_tenant_isolation'
  ) THEN
    CREATE POLICY orchestration_integrations_tenant_isolation ON orchestration_integrations
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON orchestration_integrations TO app_request;

-- Widen the proposal_type CHECK for the new executors (widening-only reshape).
ALTER TABLE orchestration_proposals
  DROP CONSTRAINT IF EXISTS orchestration_proposals_proposal_type_check;

ALTER TABLE orchestration_proposals
  ADD CONSTRAINT orchestration_proposals_proposal_type_check
  CHECK (proposal_type IN (
    'create_action',
    'servicenow_incident',
    'jira_issue',
    'teams_message',
    'slack_message',
    'send_email',
    'evidence_request',
    'escalate'));
