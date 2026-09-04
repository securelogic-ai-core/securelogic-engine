-- ROLLBACK for 20261089_vendor_invite_delivery.sql (contact-based issuance,
-- sent from SecureLogic)
--
-- Additive: six nullable/defaulted columns and two CHECKs on
-- vendor_engagement_invites. Code rollback is sufficient on its own — the
-- previous issue route never read these columns.
--
-- DATA LOSS, stated plainly: the customer's invitation messages, requested
-- due dates and the delivery-state record per invite are discarded. The
-- email_sends ledger (20261061) keeps the provider-side record independently.
-- Take a copy first:
--
--   CREATE TABLE vendor_engagement_invites_delivery_backup_20261089 AS
--     SELECT id, message, due_date, email_delivery_state, email_delivery_at,
--            email_provider_message_id, email_delivery_detail
--       FROM vendor_engagement_invites;

ALTER TABLE vendor_engagement_invites
  DROP CONSTRAINT IF EXISTS vendor_engagement_invites_message_length_check,
  DROP CONSTRAINT IF EXISTS vendor_engagement_invites_email_delivery_state_check;

ALTER TABLE vendor_engagement_invites
  DROP COLUMN IF EXISTS email_delivery_detail,
  DROP COLUMN IF EXISTS email_provider_message_id,
  DROP COLUMN IF EXISTS email_delivery_at,
  DROP COLUMN IF EXISTS email_delivery_state,
  DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS message;
