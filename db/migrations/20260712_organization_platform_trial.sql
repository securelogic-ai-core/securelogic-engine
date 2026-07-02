-- Migration: organization_platform_trial
--
-- One-time Platform free-trial tracking (PR-C2).
--
-- Records when an organization's single Platform free trial actually began.
-- Written by the Stripe webhook the moment a Platform subscription first
-- appears with status='trialing' (src/api/webhooks/stripeWebhook.ts), guarded
-- WHERE trial_started_at IS NULL so it is set at most once per org and is
-- idempotent across the trialing 'created' + 'updated' events.
--
-- The billing checkout handler (src/api/routes/billing.ts) reads this column
-- to enforce ONE trial per organization: a Platform trial checkout is rejected
-- (409 trial_already_used) when trial_started_at IS NOT NULL.
--
-- Recording at trial START (not at checkout-session creation) means an
-- abandoned trial checkout never consumes the org's single trial.
--
-- NULL  = the org has never started a Platform trial (default for all rows).
-- value = the timestamp at which the org's trial began.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
