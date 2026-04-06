-- Add stripe_customer_id to api_keys.
--
-- Context:
-- The billing checkout flow creates a Stripe Customer at session creation time
-- and stores the customer ID immediately so the portal endpoint has a reliable
-- reference regardless of webhook timing. The webhook also persists this as a
-- belt-and-suspenders fallback.
--
-- Design:
-- - Nullable: keys provisioned before billing integration have no customer.
-- - Unique: one Stripe customer per API key; duplicate checkout calls reuse
--   the existing customer rather than creating a second one.
-- - TEXT: Stripe customer IDs are stable string identifiers (e.g. cus_xxx).

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_customer
  ON api_keys (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
