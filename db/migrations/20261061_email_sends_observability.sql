-- 20261061_email_sends_observability.sql
--
-- EMAIL-OBS-1 — the join key between "we asked the provider to send" and
-- "the provider told us what happened".
--
-- THE GAP THIS CLOSES
-- -------------------
-- Provider webhook events (`email_provider_events`) carry the provider's
-- message id (`data.email_id`) but nothing in the schema recorded that id at
-- send time for any purpose except the newsletter (`newsletter_deliveries.
-- provider_message_id`, which was never written). So a bounce could not be
-- traced back to the Brief, org and subscriber that produced it, and a Brief
-- run could not be proven delivered — only "accepted", and even that was not
-- logged.
--
-- `email_sends` records ONE row per provider attempt (accepted, rejected or
-- errored) from EVERY send site, keyed by the transport's send id and carrying
-- the provider message id when the provider returned one. It is platform-level
-- (no organization column — `organization_id` is informational, no FK, so a
-- tenant erasure never has to touch it) and owner-only, the same disposition as
-- `email_provider_events`. It holds NO recipient address: the recipient is
-- described by domain and a keyed HMAC.
--
-- `email_provider_events.provider_message_id` is added so the join is a column
-- comparison rather than a JSONB path — the webhook writes it from
-- `data.email_id`; historic rows keep NULL (the value is still inside
-- `payload` for a backfill if one is ever wanted).
--
-- Deliberately NOT included: any GRANT to `app_request`. Both tables are
-- written through the elevated channel only.
--
-- Rollback:
--   DROP TABLE email_sends;
--   ALTER TABLE email_provider_events DROP COLUMN provider_message_id;

CREATE TABLE IF NOT EXISTS email_sends (
  id                     UUID        NOT NULL DEFAULT gen_random_uuid(),
  provider               TEXT        NOT NULL DEFAULT 'resend',
  provider_message_id    TEXT,
  purpose                TEXT        NOT NULL,
  organization_id        UUID,
  correlation_id         TEXT,
  environment            TEXT        NOT NULL,
  recipient_domain       TEXT,
  recipient_hash         TEXT,
  outcome                TEXT        NOT NULL,
  provider_error_name    TEXT,
  provider_error_message TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_sends_pkey PRIMARY KEY (id),
  CONSTRAINT email_sends_outcome_check
    CHECK (outcome IN ('accepted', 'provider_rejected', 'error'))
);

-- The webhook join: one provider message id maps to exactly one send.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sends_provider_message_unique
  ON email_sends (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- "Did Brief X / issue Y go out, and to how many?"
CREATE INDEX IF NOT EXISTS idx_email_sends_correlation
  ON email_sends (correlation_id, created_at DESC)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_sends_created_at
  ON email_sends (created_at DESC);

ALTER TABLE email_provider_events
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_email_provider_events_provider_message_id
  ON email_provider_events (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
