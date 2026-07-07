-- Migration: intelligence_event_notifications
-- Package: Intelligence Pipeline Hardening / IE.P7
-- Memo: docs/architecture/erip/IE-INTELLIGENCE-EVENTS-MEMO.md (IE-AD-9)
--
-- The per-org notification dedup ledger: one row per (org, event, channel) that
-- has been notified, so the intelligent notification policy never sends the same
-- Intelligence Event twice on the same channel (goal item 9 — "prevent duplicate
-- notifications"). Channels: 'immediate' (customer-impacting critical/exploited)
-- and 'digest' (the daily brief roll-up). The weekly Executive Summary is a
-- separate path and is NOT tracked here.
--
-- ORG-scoped customer-notification record (unlike the GLOBAL event tables):
-- organization_id NOT NULL, RLS enabled from creation (NOT FORCE — owner bypasses,
-- INERT until the app_request flip), app_request DML grant, registered in
-- dataClassification.ts.
--
-- DARK: nothing writes this until the notification policy ships behind
-- SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED. Additive + idempotent.
-- Reversible: DROP TABLE intelligence_event_notifications;

CREATE TABLE IF NOT EXISTS intelligence_event_notifications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- SET NULL so the notification record outlives the (global) event if it is purged.
  event_id         UUID        NULL REFERENCES intelligence_events(id) ON DELETE SET NULL,
  -- Denormalised so the dedup key survives an event delete.
  canonical_key    TEXT        NOT NULL,
  channel          TEXT        NOT NULL,
  reason           TEXT        NULL,
  notified_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_notifications_channel_check
    CHECK (channel IN ('immediate', 'digest')),
  -- Dedup: one notification per (org, canonical event, channel).
  CONSTRAINT event_notifications_unique UNIQUE (organization_id, canonical_key, channel)
);

CREATE INDEX IF NOT EXISTS idx_event_notifications_org
  ON intelligence_event_notifications (organization_id, notified_at DESC);

-- Tenant isolation — NOT FORCE (owner bypasses; inert until the app_request flip).
ALTER TABLE intelligence_event_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'intelligence_event_notifications'
       AND policyname = 'event_notifications_tenant_isolation'
  ) THEN
    CREATE POLICY event_notifications_tenant_isolation ON intelligence_event_notifications
      USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON intelligence_event_notifications TO app_request;
