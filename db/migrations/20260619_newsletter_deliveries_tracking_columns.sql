-- Newsletter deliveries — retry / delivery-tracking columns back-fill.
--
-- Finishes the partial back-fill started in 20260406_newsletter_schema.sql:
-- that migration (same author intent — "closes all of those gaps") added the
-- org-scoping column + dedup index but missed the 6 retry/delivery-tracking
-- columns below. Those columns drifted in worker boot DDL instead
-- (delivery-worker/src/runner.ts ensureDeliveryColumns), which A04-G1 phase 1
-- requires removing — the app pool connects as the non-owner app_request role
-- and cannot run ALTER TABLE. Schema must come from migrations (owner channel).
--
-- All statements use IF NOT EXISTS, so this is safe to re-run on prod/staging
-- where the worker has already created these columns at runtime.

ALTER TABLE newsletter_deliveries
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE newsletter_deliveries
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE newsletter_deliveries
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE newsletter_deliveries
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE newsletter_deliveries
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

ALTER TABLE newsletter_deliveries
  ADD COLUMN IF NOT EXISTS rendered_html TEXT;
