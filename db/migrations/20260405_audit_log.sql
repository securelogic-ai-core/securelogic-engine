CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  api_key_id      UUID        REFERENCES api_keys(id) ON DELETE SET NULL,
  actor_type      TEXT        NOT NULL,
  actor_label     TEXT,
  action          TEXT        NOT NULL,
  method          TEXT,
  route           TEXT        NOT NULL,
  status_code     INT,
  request_id      TEXT,
  duration_ms     INT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org
  ON audit_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_api_key
  ON audit_log (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at DESC);
