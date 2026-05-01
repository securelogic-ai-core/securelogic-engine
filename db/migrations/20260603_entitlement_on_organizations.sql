-- Migration: entitlement_on_organizations
--
-- Move entitlement off api_keys onto organizations as the single source of truth.
--
-- Context:
-- api_keys.entitlement_level is a denormalized cache that drifts from Stripe
-- subscription state under three patterns: customer key rotation (new key
-- inherits entitlement without Stripe linkage), admin grants (write to one
-- key, leave others stale), and org-level subscription changes (webhook
-- writes to a single key by metadata.api_key_id, leaving siblings stale).
--
-- After this migration:
--   - organizations.entitlement_level is the source of truth
--   - Stripe webhook is the sole writer (see src/api/webhooks/stripeWebhook.ts)
--   - api_keys.entitlement_level is kept nullable for rollback safety; will
--     be dropped in a follow-up after production stability is verified
--
-- Constraint moves:
--   - UNIQUE on stripe_customer_id moves from api_keys to organizations
--   - UNIQUE on stripe_subscription_id is new (sub IDs are globally unique)
--   - api_keys.entitlement_level NOT NULL is dropped so new INSERTs in
--     customerApiKeys.ts can omit the column

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add columns to organizations
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id         TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_tier   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_failed_at          TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. UNIQUE indexes on the new identifier columns
--
-- Partial UNIQUE (filtered NULL) matches the existing pattern in
-- 20260406_stripe_customer.sql and is more explicit about NULL semantics
-- than column-level UNIQUE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer_id_key
  ON organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_subscription_id_key
  ON organizations (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Drop NOT NULL on api_keys.entitlement_level
--
-- Required because customerApiKeys.ts will stop including the column in its
-- INSERT statement. The column itself stays for rollback safety; old rows
-- retain their values.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE api_keys
  ALTER COLUMN entitlement_level DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill organizations.stripe_customer_id from api_keys
--
-- For each org, take the customer ID from the most-recently-created api_key
-- that has one. Sanity check (run before this migration) confirmed no org
-- has multiple keys carrying customer IDs; the DISTINCT ON heuristic is
-- single-valued in practice. The ORDER BY is defensive.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE organizations o
   SET stripe_customer_id = sub.stripe_customer_id
  FROM (
    SELECT DISTINCT ON (organization_id)
           organization_id,
           stripe_customer_id
      FROM api_keys
     WHERE stripe_customer_id IS NOT NULL
     ORDER BY organization_id, created_at DESC
  ) sub
 WHERE o.id = sub.organization_id
   AND o.stripe_customer_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Heal the dual-column drift on organizations
--
-- organizations.entitlement_level was added by 20260520_multi_user_team.sql
-- and backfilled once from api_keys; nothing has written it since. Meanwhile
-- organizations.plan was kept current by the Stripe webhook. Where the two
-- disagree, plan is the live value — trust it.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE organizations
   SET entitlement_level = plan
 WHERE entitlement_level <> plan;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Backfill organizations.payment_failed_at from api_keys
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE organizations o
   SET payment_failed_at = sub.payment_failed_at
  FROM (
    SELECT DISTINCT ON (organization_id)
           organization_id,
           payment_failed_at
      FROM api_keys
     WHERE payment_failed_at IS NOT NULL
     ORDER BY organization_id, created_at DESC
  ) sub
 WHERE o.id = sub.organization_id
   AND o.payment_failed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Backfill organizations.stripe_subscription_tier from api_keys
--
-- stripe_subscription_id and stripe_subscription_status have no source in
-- api_keys; they will be NULL post-migration and populated by the next
-- webhook event for each customer. The tier label, however, was being kept
-- on api_keys and is worth preserving so /api/me responses don't briefly
-- show null tier between deploy and the next webhook delivery.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE organizations o
   SET stripe_subscription_tier = sub.stripe_subscription_tier
  FROM (
    SELECT DISTINCT ON (organization_id)
           organization_id,
           stripe_subscription_tier
      FROM api_keys
     WHERE stripe_subscription_tier IS NOT NULL
     ORDER BY organization_id, created_at DESC
  ) sub
 WHERE o.id = sub.organization_id
   AND o.stripe_subscription_tier IS NULL;
