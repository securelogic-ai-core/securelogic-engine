-- 20261028_billing_dunning_cycles.sql
--
-- One durable row per delinquency cycle (SL-BILL-1 PR-B).
--
-- WHY A ROW AND NOT A LOG LINE. Two things need durable state that logs cannot
-- provide:
--
--   1. NOTIFICATION IDEMPOTENCY. Stripe sends invoice.payment_failed on EVERY
--      retry — up to 8 over a 2-week Smart Retries window. Emailing on the
--      event would send the customer eight "your payment failed" notices. The
--      cycle row is the idempotency token: the FIRST failure inserts it, every
--      retry conflicts, and each notification stage is claimed by a conditional
--      UPDATE before the email is sent. A crash between claim and send costs at
--      most one un-sent notice, which is the safe direction — a missing warning
--      is recoverable, a duplicate one is not.
--
--   2. RECOVERY RATE. "Did dunning work?" is a business question and there is
--      no metrics sink in this platform to answer it from logs. With this table
--      it is one query:
--        SELECT count(*) FILTER (WHERE recovered_at IS NOT NULL)::float
--             / NULLIF(count(*), 0) FROM billing_dunning_cycles;
--
-- CYCLE IDENTITY is (organization_id, cycle_started_at), where cycle_started_at
-- is organizations.payment_failed_at — the FIRST failure of the cycle, on
-- Stripe's clock (ruling R1). Keying on the org alone would suppress a second,
-- unrelated delinquency months later; keying on the event would create a row
-- per retry.
--
-- Recovery clears organizations.payment_failed_at, so the next delinquency
-- starts a new cycle with a new cycle_started_at and gets its own row and its
-- own full notification sequence.
--
-- CONTENT: ids, timestamps and a Stripe subscription/event reference. No
-- amounts, no card data, no customer PII, no user or session id.

CREATE TABLE IF NOT EXISTS billing_dunning_cycles (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- = organizations.payment_failed_at at the moment the cycle opened.
  cycle_started_at        TIMESTAMPTZ NOT NULL,

  stripe_subscription_id  TEXT,
  -- The Stripe event that opened the cycle. Forensics only.
  first_event_id          TEXT,

  -- Notification stages. Each is CLAIMED (set from NULL) before its email is
  -- sent, so the claim is the concurrency control and the audit trail at once.
  notified_day0_at        TIMESTAMPTZ,
  notified_day7_at        TIMESTAMPTZ,
  notified_day14_at       TIMESTAMPTZ,

  -- Terminal outcomes. Mutually exclusive in practice; both NULL = still open.
  recovered_at            TIMESTAMPTZ,
  lapsed_at               TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, cycle_started_at)
);

-- The sweep's candidate scan: open cycles, oldest first.
CREATE INDEX IF NOT EXISTS idx_billing_dunning_cycles_open
  ON billing_dunning_cycles (cycle_started_at)
  WHERE recovered_at IS NULL AND lapsed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_dunning_cycles_org
  ON billing_dunning_cycles (organization_id, cycle_started_at DESC);

-- Tenant isolation. The WRITE path is the Stripe webhook, which has no tenant
-- scope (it is a provider callback, not a user request) and therefore uses the
-- elevated channel deliberately. The policy exists so that when `pg` moves from
-- the owner credential to the non-owner app_request role, any READ path added
-- later — a billing dashboard, an admin view — is org-scoped by construction
-- rather than by remembering to add a predicate.
ALTER TABLE billing_dunning_cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_dunning_cycles_tenant_isolation ON billing_dunning_cycles;
CREATE POLICY billing_dunning_cycles_tenant_isolation ON billing_dunning_cycles
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- No DELETE and no INSERT for the request role: cycles are opened by the
-- webhook on the elevated channel, and nothing on the request path may forge or
-- destroy a billing record. Erasure runs via the organizations CASCADE above.
GRANT SELECT ON billing_dunning_cycles TO app_request;

COMMENT ON TABLE billing_dunning_cycles IS
  'One row per delinquency cycle. Identity is (organization_id, cycle_started_at = organizations.payment_failed_at). Provides notification idempotency (claim-then-send) and the durable data behind dunning recovery rate.';
