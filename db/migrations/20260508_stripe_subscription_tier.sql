-- Preserves the raw Stripe subscription tier from checkout metadata.
--
-- Design:
-- - Written when entitlement is GRANTED (checkout.session.completed,
--   customer.subscription.created/updated). Not cleared on cancellation —
--   retains historical tier knowledge.
-- - Values: 'professional' ($49/mo) or 'team' ($249/mo), or NULL for
--   legacy keys provisioned before tier metadata was introduced.
-- - Does NOT drive access control. entitlement_level is authoritative.
--   This column exists purely for future tier-specific feature gating
--   (e.g. team-only features, seat limits, org-level capabilities).
-- - Distinct from entitlement_level: 'team' maps to entitlement_level
--   'premium' but this column retains the original tier name.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS stripe_subscription_tier TEXT;
