-- 20261089_vendor_invite_delivery.sql
-- Contact-based questionnaire issuance, sent from SecureLogic (goal §A/§B,
-- 2026-09-04).
--
-- Until now an invitation was born, its raw token was shown to the customer
-- ONCE, and the customer mailed it themselves. SecureLogic now composes and
-- sends the invitation through the ONE shared transactional mailer
-- (src/api/infra/email.ts → emailTransport.ts, the EMAIL-OBS-1 choke point),
-- and the invite row records what the customer wrote and what happened to it.
--
-- Additive columns on `vendor_engagement_invites`:
--
--   message               the customer's invitation message, as sent. Authored
--                         text, kept BY VALUE so the historical record says what
--                         the vendor was told. NULL for pre-existing rows and
--                         for copy-link-only issuance.
--   due_date              the response date the customer asked for, shown to
--                         the vendor in the email and the portal. NULL = none.
--   email_delivery_state  what SecureLogic did with the email:
--                           not_attempted  copy-link only, or pre-existing row
--                           sent           accepted by the provider
--                           failed         provider rejected / errored
--                           suppressed     recipient is on email_suppressions
--                           disabled       SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED
--                                          is not "true" in this environment
--                         Delivery beyond acceptance (bounces, opens) lives in
--                         the provider-event ledger keyed by the send below.
--   email_delivery_at     when that state was recorded.
--   email_provider_message_id
--                         the provider's message id for an accepted send — the
--                         join to the `email_sends` ledger (EMAIL-OBS-1, unique
--                         on (provider, provider_message_id)) and to the
--                         provider-event webhook rows. No FK: the observability
--                         ledger has its own retention and must never RESTRICT
--                         an invite.
--   email_delivery_detail short provider/transport reason on failure. Never
--                         the address, subject or body.
--
-- The invite's contact_email/contact_name SNAPSHOT and contact_id binding
-- (20261056) are unchanged: the contact is the addressee's identity, the
-- snapshot is what we mailed, and this migration records THAT we mailed it.
--
-- Rollback: docs/release/ROLLBACK-20261089.sql

ALTER TABLE vendor_engagement_invites
  ADD COLUMN IF NOT EXISTS message               TEXT        NULL,
  ADD COLUMN IF NOT EXISTS due_date              DATE        NULL,
  ADD COLUMN IF NOT EXISTS email_delivery_state  TEXT        NOT NULL DEFAULT 'not_attempted',
  ADD COLUMN IF NOT EXISTS email_delivery_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email_provider_message_id TEXT     NULL,
  ADD COLUMN IF NOT EXISTS email_delivery_detail TEXT        NULL;

ALTER TABLE vendor_engagement_invites
  DROP CONSTRAINT IF EXISTS vendor_engagement_invites_email_delivery_state_check;
ALTER TABLE vendor_engagement_invites
  ADD CONSTRAINT vendor_engagement_invites_email_delivery_state_check
  CHECK (email_delivery_state IN ('not_attempted', 'sent', 'failed', 'suppressed', 'disabled'));

-- A message is bounded: it is rendered into an email body verbatim (escaped).
ALTER TABLE vendor_engagement_invites
  DROP CONSTRAINT IF EXISTS vendor_engagement_invites_message_length_check;
ALTER TABLE vendor_engagement_invites
  ADD CONSTRAINT vendor_engagement_invites_message_length_check
  CHECK (message IS NULL OR length(message) <= 4000);

COMMENT ON COLUMN vendor_engagement_invites.email_delivery_state IS
  'What SecureLogic did with the invitation email: not_attempted | sent | failed | suppressed | disabled. Provider-side delivery events join through email_provider_message_id.';
