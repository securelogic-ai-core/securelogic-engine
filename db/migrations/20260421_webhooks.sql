-- Sprint 27: Outbound customer webhooks
-- webhook_endpoints: per-org registry of customer HTTP endpoints
-- webhook_deliveries: full delivery log for every dispatch attempt

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url              TEXT        NOT NULL,
  secret           TEXT        NOT NULL,
  description      TEXT,
  status           TEXT        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'disabled', 'failed')),
  event_types      TEXT[]      NOT NULL DEFAULT ARRAY['*'],
  failure_count    INTEGER     NOT NULL DEFAULT 0,
  last_success_at  TIMESTAMPTZ,
  last_failure_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_endpoint_id  UUID        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type           TEXT        NOT NULL,
  event_id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  payload              JSONB       NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
  attempt_count        INTEGER     NOT NULL DEFAULT 0,
  max_attempts         INTEGER     NOT NULL DEFAULT 3,
  response_status      INTEGER,
  response_body        TEXT,
  error_message        TEXT,
  next_retry_at        TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org
  ON webhook_endpoints (organization_id);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org
  ON webhook_deliveries (organization_id);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
  ON webhook_deliveries (status)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON webhook_deliveries (next_retry_at)
  WHERE status = 'retrying';
