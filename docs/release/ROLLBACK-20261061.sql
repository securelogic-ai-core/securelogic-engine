-- ROLLBACK for 20261061_email_sends_observability (EMAIL-OBS-1).
--
-- Filed against the Option-B curated release-candidate review, which found
-- 20261061 to be the one migration in the 20261059-20261079 range with no
-- executable rollback. docs/release/ROLLBACK-20261059-20261061.sql does NOT
-- cover it: that file's header reserved slot 20261061 for a VA-Q1 bridge
-- backfill, the slot was taken by this migration instead, and the file
-- contains no reference to email_sends. This closes the gap; the statements
-- are exactly the two the forward migration's own header specifies, made
-- idempotent and stated explicitly.
--
-- Code rollback (redeploy the previous SHA) is sufficient ON ITS OWN. Run this
-- only if the schema itself must go. Two independent reasons:
--
--   1. `email_sends` is written from ONE place — persistSend() in
--      src/api/infra/emailTransport.ts — which is best-effort by construction:
--      try/catch around a query raced against PERSIST_TIMEOUT_MS, logging
--      `email_send_record_failed` rather than throwing. A send the provider
--      already accepted is never reported failed because this write failed, so
--      older code that does not know the table is unaffected either way.
--   2. Nothing READS email_sends on a customer path. It is platform-level,
--      owner-only, written through the elevated channel, with no GRANT to
--      app_request.
--
-- DATA LOSS, stated plainly: dropping the table discards the send ledger, and
-- dropping the column discards the denormalised join key. Neither is a system
-- of record for anything else. `email_provider_events.payload` still contains
-- the provider id at `data.email_id`, so the column is reconstructible by
-- backfill; the send-side rows are not. Take a dump first if the ledger is
-- wanted for forensics.
--
-- Idempotent and re-runnable. Order is the reverse of the forward migration.

-- Reverse of: ALTER TABLE email_provider_events ADD COLUMN provider_message_id
-- (the index is dropped explicitly rather than relying on the column drop
-- cascading to it, so the intent is legible and the file is safe to run
-- against a partially-applied forward migration).
DROP INDEX IF EXISTS idx_email_provider_events_provider_message_id;
ALTER TABLE email_provider_events
  DROP COLUMN IF EXISTS provider_message_id;

-- Reverse of: CREATE TABLE email_sends + its three indexes. Dropping the table
-- removes idx_email_sends_provider_message_unique, idx_email_sends_correlation
-- and idx_email_sends_created_at with it, along with the email_sends_pkey and
-- email_sends_outcome_check constraints.
DROP TABLE IF EXISTS email_sends;
