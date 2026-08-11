-- 20260811_email_provider_events_ddl_reconciliation.sql
--
-- Brings `email_provider_events` under migration control.
--
-- THE GAP THIS CLOSES
-- -------------------
-- This table has always existed in the PRODUCTION database and has never had a
-- CREATE TABLE migration. It was created by hand. `docs/A04-G1-table-
-- classification.md:69` has carried the warning for some time:
--
--     "no CREATE TABLE migration in db/migrations/ on develop —
--      schema-in-DB only (migration gap, reconcile separately)"
--
-- This is that reconciliation, and it stopped being a paperwork item on
-- 2026-08-10 when a second Resend webhook was pointed at staging. Staging has
-- every other email table (`email_suppressions`, `subscribers`,
-- `newsletter_deliveries`) but not this one, because only migrations create
-- staging's schema. So every inbound provider event hit
--
--     INSERT INTO email_provider_events ...
--       -> relation "email_provider_events" does not exist
--
-- and the whole webhook transaction failed. Verified on 2026-08-11: staging
-- logged an error for every webhook POST from 22:43:57Z onward, and demo is
-- missing the table too. The consequence is not just a broken endpoint —
-- staging cannot validate ANY inbound email behaviour, which is exactly what
-- the P1-2 environment-isolation work needs to prove before enforcement, and
-- the provider has been receiving 5xx from a registered endpoint continuously.
--
-- SHAPE IS COPIED FROM PRODUCTION, NOT INVENTED
-- ---------------------------------------------
-- Read from the live production database (information_schema + pg_indexes,
-- read-only) on 2026-08-11 so staging converges on what production actually
-- runs rather than on a plausible reconstruction. Note `provider_event_id` is
-- nullable and sits after `created_at` in production's column order because it
-- was added later; column order is not semantic, so a fresh CREATE places it
-- naturally.
--
-- Idempotent by construction: production already has all of this, so every
-- statement is a no-op there and the migration simply records itself. It
-- CREATES the table on staging and demo.
--
-- Deliberately NOT included:
--   * No GRANT to `app_request`. Production grants this table to the owner role
--     only and has RLS disabled (verified live). Adding a grant here would be a
--     privilege change smuggled into a drift repair. When the app_request flip
--     happens this table needs its own reviewed decision — it is SHARED-REF in
--     the A04-G1 classification, with no organization_id.
--   * No attempt to reproduce production's DUPLICATE index. Production carries
--     both `idx_email_provider_events_provider_event_id` and
--     `idx_email_provider_events_provider_event_unique` with identical
--     definitions — a by-hand artefact. Only the canonical one is created here.
--     Dropping the redundant copy in production is a separate change; it is
--     harmless apart from write cost and index bloat.
--
-- Rollback:
--   DROP TABLE email_provider_events;
--   -- NEVER run this against production: it holds 5,339 rows of real provider
--   -- event history (count read 2026-08-11) and is the source the deliverability
--   -- diagnosis and the P1-2 evidence endpoint read.

CREATE TABLE IF NOT EXISTS email_provider_events (
  id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
  provider           TEXT        NOT NULL,
  provider_event_id  TEXT,
  event_type         TEXT        NOT NULL,
  email              TEXT,
  payload            JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_provider_events_pkey PRIMARY KEY (id)
);

-- Dedup. The webhook relies on this raising 23505 to detect a redelivered
-- event and answer {duplicate: true} instead of double-writing a suppression,
-- so the partial UNIQUE is load-bearing, not an optimisation. Partial because
-- `provider_event_id` is nullable and historic rows predate it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_events_provider_event_unique
  ON email_provider_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- Recency reads: the admin event list and the P1-2 evidence window.
CREATE INDEX IF NOT EXISTS idx_email_provider_events_created_at
  ON email_provider_events (created_at DESC);

-- "Why can this address not receive our mail" — deliverability diagnosis.
CREATE INDEX IF NOT EXISTS idx_email_provider_events_email
  ON email_provider_events (email);

-- Keyset pagination in adminEmailProviderEvents.ts: WHERE (created_at, id) < ($,$).
CREATE INDEX IF NOT EXISTS idx_email_provider_events_cursor
  ON email_provider_events (created_at DESC, id DESC);
