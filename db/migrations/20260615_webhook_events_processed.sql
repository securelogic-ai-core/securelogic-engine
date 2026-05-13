-- C3: inbound webhook idempotency for Stripe + Lemon Squeezy.
--
-- INSERT ... ON CONFLICT (provider, event_id) DO NOTHING gives an atomic
-- "have I processed this?" check at the database level. The handler claims
-- the row before any downstream side effect; if the INSERT returns
-- rowCount = 0, the event has already been processed and the handler must
-- short-circuit. If the INSERT throws (Postgres unhealthy), the handler
-- returns 500 so the provider's own retry mechanism handles the window —
-- silently re-processing during a Postgres outage is worse than fail-closed.
--
-- Migration sequence note: the repo's migration numbers are a forward-
-- running sequence, not real calendar dates. 20260615 sequences after
-- 20260614_security_audit_log_immutable.sql.

CREATE TABLE IF NOT EXISTS webhook_events_processed (
  provider     TEXT        NOT NULL CHECK (provider IN ('stripe', 'lemon')),
  event_id     TEXT        NOT NULL,
  event_type   TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_received_at
  ON webhook_events_processed (received_at);
