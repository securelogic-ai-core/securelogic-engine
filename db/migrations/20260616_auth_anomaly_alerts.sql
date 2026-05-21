-- Migration: auth_anomaly_alerts
-- Package: auth-anomaly-alerting (A04-G4 / A09-G2)
--
-- Adds:
--   1. auth_anomaly_alerts — dedup ledger for the Tier 2 auth-anomaly scan
--      (src/api/lib/authAnomaly.ts → runAuthAnomalyScan). One row per
--      (anomaly_type, subject); an over-threshold IP is re-alerted at most
--      once per cooldown. The cooldown itself is enforced in application SQL
--      (INSERT ... ON CONFLICT DO UPDATE WHERE last_alerted_at < NOW() -
--      interval), not by a constraint here.
--
--   2. A composite index on security_audit_log sized to the Tier 2 scan
--      queries: event_type equality + created_at range + GROUP BY ip_address.
--
-- The scan runs inside the engine web service's node-cron host (NOT a
-- worker), so this migration auto-applies on engine deploy and the table is
-- present wherever it is read. No worker touches auth_anomaly_alerts.
--
-- Additive only. No data backfill. Idempotent (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS auth_anomaly_alerts (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_type      TEXT         NOT NULL CHECK (
    anomaly_type IN ('credential_stuffing', 'api_key_probing')
  ),
  subject           TEXT         NOT NULL,        -- the offending source IP
  first_alerted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_alerted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  alert_count       INTEGER      NOT NULL DEFAULT 1 CHECK (alert_count > 0),

  CONSTRAINT auth_anomaly_alerts_type_subject_unique UNIQUE (anomaly_type, subject)
);

-- Tier 2 scan support. The existing idx_security_audit_log_event_type
-- (event_type, created_at DESC) already covers the event_type + time filter;
-- appending ip_address makes the GROUP BY ip_address index-resident.
CREATE INDEX IF NOT EXISTS idx_security_audit_log_event_created_ip
  ON security_audit_log (event_type, created_at DESC, ip_address);
