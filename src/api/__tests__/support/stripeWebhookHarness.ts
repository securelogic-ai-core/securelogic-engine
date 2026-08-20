/**
 * stripeWebhookHarness.ts — a simulated `organizations` row plus a query mock
 * that speaks the SQL the Stripe webhook writes.
 *
 * WHY SIMULATE. The webhook handlers are driven end to end (the exported
 * `stripeWebhook` is called with real event payloads), so the assertions can be
 * about the state an org ENDS IN after a webhook SEQUENCE — which is the
 * contract that matters and the one no source-shape test can hold. That needs a
 * store with real semantics, not a stub returning fixed rows.
 *
 * The mock therefore mirrors the real statements exactly where it counts:
 *   - COALESCE on the Stripe mirror columns,
 *   - payment_failed_at cleared ONLY on a grant for an active subscription,
 *   - and the ORDERING PREDICATE (SL-BILL-1 PR-D), which is the whole point of
 *     the ordering tests: an UPDATE whose predicate rejects the event must
 *     match no row, exactly as Postgres would.
 *
 * Getting those arms wrong would make every file that uses this harness lie, so
 * they are written once, here, rather than per test file.
 */
import { vi } from "vitest";

export type OrgRow = {
  id: string;
  entitlement_level: string | null;
  plan: string | null;
  payment_failed_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_subscription_tier: string | null;
  stripe_billing_event_at: number | null;
  stripe_billing_event_id: string | null;
  max_monitored_entities: number | null;
  max_members: number | null;
};

/** The store under test. Reassign `ORG.row` per test. */
export const ORG: { row: OrgRow } = { row: null as unknown as OrgRow };

export function anOrg(over: Partial<OrgRow> = {}): OrgRow {
  return {
    id: "org-1",
    entitlement_level: "premium",
    plan: "premium",
    payment_failed_at: null,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    stripe_subscription_status: "active",
    stripe_subscription_tier: "platform",
    stripe_billing_event_at: null,
    stripe_billing_event_id: null,
    max_monitored_entities: 50,
    max_members: 10,
    ...over,
  };
}

/**
 * The ordering rule, mirrored from ORDERING_PREDICATE in stripeWebhook.ts.
 *
 * NULL watermark applies; strictly newer applies; same second with a DIFFERENT
 * event id applies (genuinely concurrent — Stripe exposes nothing finer);
 * same second with the SAME id is a duplicate; older is stale.
 */
export function orderingAllows(org: OrgRow, created: number, eventId: string): boolean {
  if (org.stripe_billing_event_at === null) return true;
  if (org.stripe_billing_event_at < created) return true;
  if (org.stripe_billing_event_at === created) {
    return org.stripe_billing_event_id !== eventId;
  }
  return false;
}

export const queryMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const org = ORG.row;

  if (/SELECT id\s+FROM organizations\s+WHERE stripe_customer_id/i.test(sql)) {
    return org && org.stripe_customer_id === params[0]
      ? { rows: [{ id: org.id }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  if (/^\s*SELECT/i.test(sql) && /FROM organizations WHERE id = \$1/i.test(sql)) {
    return org && org.id === params[0] ? { rows: [org], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // The guarded entitlement write.
  if (/UPDATE organizations/i.test(sql) && /SET entitlement_level/i.test(sql)) {
    const [level, orgId, customerId, subId, rawTier, status, clearFailed, created, eventId] =
      params as [string, string, string | null, string | null, string | null, string | null, boolean, number, string];
    if (!org || org.id !== orgId) return { rows: [], rowCount: 0 };
    // The mock enforces exactly what the STATEMENT asks for. Ordering is
    // checked only when the SQL actually carries the predicate — so reverting
    // the handler for a failing-first proof measures the code under test, not
    // an artefact of this harness.
    if (/stripe_billing_event_at/.test(sql) && !orderingAllows(org, created, eventId)) {
      return { rows: [], rowCount: 0 };
    }
    org.entitlement_level = level;
    org.plan = level;
    org.stripe_customer_id = org.stripe_customer_id ?? customerId;
    org.stripe_subscription_id = subId ?? org.stripe_subscription_id;
    org.stripe_subscription_tier = rawTier ?? org.stripe_subscription_tier;
    org.stripe_subscription_status = status ?? org.stripe_subscription_status;
    if (clearFailed) org.payment_failed_at = null;
    if (/stripe_billing_event_at/.test(sql)) {
      org.stripe_billing_event_at = created;
      org.stripe_billing_event_id = eventId;
    }
    return { rows: [], rowCount: 1 };
  }

  // The guarded payment-failure stamp.
  if (/UPDATE organizations/i.test(sql) && /SET payment_failed_at\s+= NOW\(\)/i.test(sql)) {
    const [customerId, created, eventId, invoiceSubId] =
      params as [string, number, string, string | null];
    if (!org || org.stripe_customer_id !== customerId) return { rows: [], rowCount: 0 };
    // D6: bites only when BOTH sides are known, and only when the statement
    // carries the guard.
    if (/stripe_subscription_id = \$4/.test(sql) &&
        invoiceSubId != null && org.stripe_subscription_id !== null &&
        org.stripe_subscription_id !== invoiceSubId) {
      return { rows: [], rowCount: 0 };
    }
    if (/stripe_billing_event_at/.test(sql)) {
      if (!orderingAllows(org, created, eventId)) return { rows: [], rowCount: 0 };
      org.stripe_billing_event_at = created;
      org.stripe_billing_event_id = eventId;
    }
    org.payment_failed_at = "2026-08-20T00:00:00.000Z";
    return { rows: [], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
});
