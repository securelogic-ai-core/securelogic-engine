-- 20261027_organizations_stripe_event_watermark.sql
--
-- Billing-event ordering watermark (SL-BILL-1 PR-D, defect D5).
--
-- WHY: webhook idempotency was solid for DUPLICATES — claimWebhookEvent does
-- an atomic INSERT ... ON CONFLICT (provider, event_id) DO NOTHING and fails
-- closed — but ORDERING was unprotected. Stripe does not guarantee delivery
-- order. Nothing compared an incoming event against the state already applied,
-- and the only ordering guard in the handler (the superseded-subscription check
-- on customer.subscription.deleted) explicitly does not cover .updated.
--
-- So a delayed customer.subscription.updated(past_due) landing AFTER the
-- recovery customer.subscription.updated(active) silently downgraded a customer
-- who had already paid: entitlement_level back to 'starter', 403s across the
-- gated route surface, and no signal that a stale event caused it.
--
-- These two columns are the watermark. Every billing-state write carries the
-- (event.created, event.id) that caused it, and every billing-state write is
-- guarded by a WHERE clause comparing against the stored pair — so the compare
-- and the write are ONE atomic statement and no lock or read-modify-write
-- window exists.
--
-- stripe_billing_event_at is the STRIPE clock (event.created), never ours.
-- Stripe/backend billing state is authoritative; processing time is not, and
-- ordering decided by our receipt time would re-introduce the very bug this
-- closes.
--
-- NULL means "no billing event has been applied to this org yet". Every
-- existing row starts NULL, so the first event after deploy applies
-- unconditionally and sets the watermark. No backfill is required or wanted:
-- inventing a watermark for historical rows would suppress a legitimate next
-- event.
--
-- Idempotent. No RLS/grant change: organizations carries table-level grants and
-- these columns are read and written only by the webhook path.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_billing_event_at TIMESTAMPTZ;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_billing_event_id TEXT;

COMMENT ON COLUMN organizations.stripe_billing_event_at IS
  'event.created of the most recent Stripe billing-state event applied to this org (Stripe''s clock, not ours). NULL = none applied yet. Guards every billing-state write against out-of-order delivery: an event older than this is suppressed.';

COMMENT ON COLUMN organizations.stripe_billing_event_id IS
  'event.id that set stripe_billing_event_at. Distinguishes a re-delivery of the SAME event (suppressed) from a DIFFERENT event carrying the same one-second event.created (applied).';
