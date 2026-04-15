-- Tracks the most recent Stripe payment failure on an API key.
--
-- Design:
-- - Stamped by the invoice.payment_failed webhook handler.
-- - Does NOT trigger access revocation on its own — access is controlled
--   by entitlement_level. This column is for observability, dunning UX,
--   and downstream alerting only.
-- - Cleared (set to NULL) when a subsequent payment succeeds and
--   entitlement is re-granted by checkout.session.completed or
--   customer.subscription.updated (active).
-- - Nullable: keys that have never had a payment failure have NULL.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_payment_failed_at
  ON api_keys (payment_failed_at)
  WHERE payment_failed_at IS NOT NULL;
