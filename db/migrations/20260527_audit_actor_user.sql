-- 20260527_audit_actor_user.sql
--
-- Adds actor_user_id to security_audit_log so that JWT-authenticated users
-- can be attributed in audit events. Prior to this migration the table stored
-- only actor_api_key_id (the org-level API key), which made it impossible to
-- identify which human performed an action when accessing via the JWT bridge.
--
-- actor_user_id is nullable — system/scheduler events and API-key-only callers
-- have no user actor. ON DELETE SET NULL preserves audit history if a user is
-- later removed.

ALTER TABLE security_audit_log
  ADD COLUMN IF NOT EXISTS actor_user_id UUID
    REFERENCES users(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_security_audit_log_actor_user
  ON security_audit_log (actor_user_id)
  WHERE actor_user_id IS NOT NULL;
