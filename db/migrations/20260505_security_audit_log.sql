-- 20260505_security_audit_log.sql
--
-- Adds a security_audit_log table for structured business-level audit events.
-- This is distinct from the audit_log table (HTTP request log) — security_audit_log
-- captures meaningful platform events: state transitions, resource mutations,
-- data ingestion events, auth probes, and key lifecycle events.
--
-- Schema:
--   id               — PK
--   organization_id  — nullable (platform-level events have no org scope)
--   actor_api_key_id — nullable FK to api_keys; SET NULL on key deletion
--   event_type       — canonical event identifier (e.g. 'workflow.status_transition')
--   resource_type    — entity class (e.g. 'risk_treatment', 'finding')
--   resource_id      — entity UUID (nullable for batch / non-resource events)
--   payload          — JSONB of event-specific data (nullable)
--   ip_address       — source IP (nullable; extracted from request at write time)
--   created_at       — event timestamp (immutable once written)
--
-- Indexes:
--   (organization_id, created_at DESC) — primary org-scoped pagination
--   (resource_type, resource_id)       — resource-level history queries

CREATE TABLE security_audit_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NULL        REFERENCES organizations(id) ON DELETE SET NULL,
  actor_api_key_id UUID        NULL        REFERENCES api_keys(id) ON DELETE SET NULL,
  event_type       TEXT        NOT NULL,
  resource_type    TEXT        NOT NULL,
  resource_id      UUID        NULL,
  payload          JSONB       NULL,
  ip_address       TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_security_audit_log_org_created
  ON security_audit_log (organization_id, created_at DESC);

CREATE INDEX idx_security_audit_log_resource
  ON security_audit_log (resource_type, resource_id);

CREATE INDEX idx_security_audit_log_event_type
  ON security_audit_log (event_type, created_at DESC);
