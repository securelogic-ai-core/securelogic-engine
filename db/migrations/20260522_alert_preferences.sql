-- Alert preferences per user
CREATE TABLE IF NOT EXISTS user_alert_preferences (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  critical_finding_immediate BOOLEAN NOT NULL DEFAULT TRUE,
  daily_digest              BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_summary            BOOLEAN NOT NULL DEFAULT TRUE,
  high_finding_immediate    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

-- Deduplication log for sent alerts
CREATE TABLE IF NOT EXISTS alert_sends (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_type   TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_sends_dedup_idx
  ON alert_sends (user_id, alert_type, reference_id);

CREATE INDEX IF NOT EXISTS alert_sends_user_type_idx
  ON alert_sends (user_id, alert_type, sent_at DESC);
