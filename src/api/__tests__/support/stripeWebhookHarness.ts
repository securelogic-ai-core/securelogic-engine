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

  if (/SELECT name FROM organizations WHERE id/i.test(sql)) {
    return org && org.id === params[0]
      ? { rows: [{ name: "Test Org" }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  // Verified admins — the dunning email's recipients. Two of them, so a test
  // that asserts "one email" cannot pass by accident on a single-recipient org.
  if (/SELECT email, name FROM users/i.test(sql)) {
    return {
      rows: [
        { email: "admin1@example.com", name: "Admin One" },
        { email: "admin2@example.com", name: "Admin Two" },
      ],
      rowCount: 2,
    };
  }

  // Whitespace-tolerant: the webhook writes this on one line, the request
  // middleware across several.
  if (/^\s*SELECT/i.test(sql) && /FROM organizations\s+WHERE id = \$1/i.test(sql)) {
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
  if (/UPDATE organizations/i.test(sql) && /SET\s+payment_failed_at/i.test(sql)) {
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
    // RULING R1: COALESCE — the FIRST failure of the cycle wins, stamped from
    // Stripe's clock. Retries find a value and leave it alone. The harness
    // mirrors whichever the statement actually asks for, so a failing-first
    // proof measures the code.
    const stampFromEvent = new Date(created * 1000).toISOString();
    if (/COALESCE\(payment_failed_at/i.test(sql)) {
      org.payment_failed_at = org.payment_failed_at ?? stampFromEvent;
    } else {
      org.payment_failed_at = stampFromEvent;
    }
    return {
      rows: [{
        id: org.id,
        payment_failed_at: org.payment_failed_at,
        stripe_subscription_status: org.stripe_subscription_status,
      }],
      rowCount: 1,
    };
  }

  return { rows: [], rowCount: 0 };
});


/* ── Simulated billing_dunning_cycles ────────────────────────────────────── */

export type CycleRow = {
  id: string;
  organization_id: string;
  cycle_started_at: string;
  stripe_subscription_id: string | null;
  first_event_id: string | null;
  notified_day0_at: string | null;
  notified_day7_at: string | null;
  notified_day14_at: string | null;
  recovered_at: string | null;
  lapsed_at: string | null;
};

export const CYCLES: { rows: CycleRow[] } = { rows: [] };

export function resetCycles(): void {
  CYCLES.rows = [];
}

const NOW_ISO = "2026-09-01T00:00:00.000Z";
let cycleSeq = 0;

/**
 * The elevated pool, which is where billingDunningCycle.ts writes — a Stripe
 * webhook is a provider callback with no tenant scope, so the cycle row is
 * written cross-org by design. This mirrors the UNIQUE (organization_id,
 * cycle_started_at) constraint and the conditional stage claims, because those
 * ARE the notification-idempotency mechanism: getting them wrong here would let
 * a "sends exactly once" test pass against code that sends eight times.
 */
export const elevatedQueryMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const asIso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : String(v);

  if (/INSERT INTO billing_dunning_cycles/i.test(sql)) {
    const [orgId, startedAt, subId, eventId] = params as [string, unknown, string | null, string | null];
    const started = asIso(startedAt);
    const clash = CYCLES.rows.find(
      (r) => r.organization_id === orgId && r.cycle_started_at === started
    );
    if (clash) return { rows: [], rowCount: 0 };
    const row: CycleRow = {
      id: `cycle-${++cycleSeq}`,
      organization_id: orgId,
      cycle_started_at: started,
      stripe_subscription_id: subId,
      first_event_id: eventId,
      notified_day0_at: null,
      notified_day7_at: null,
      notified_day14_at: null,
      recovered_at: null,
      lapsed_at: null,
    };
    CYCLES.rows.push(row);
    return { rows: [{ id: row.id }], rowCount: 1 };
  }

  if (/SELECT id FROM billing_dunning_cycles/i.test(sql)) {
    const [orgId, startedAt] = params as [string, unknown];
    const started = asIso(startedAt);
    const row = CYCLES.rows.find(
      (r) => r.organization_id === orgId && r.cycle_started_at === started
    );
    return row ? { rows: [{ id: row.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/UPDATE billing_dunning_cycles/i.test(sql) && /SET notified_day(\d+)_at/i.test(sql)) {
    const stage = /notified_day0_at/.test(sql) ? "notified_day0_at"
      : /notified_day7_at/.test(sql) ? "notified_day7_at"
      : "notified_day14_at";
    const [cycleId] = params as [string];
    const row = CYCLES.rows.find((r) => r.id === cycleId);
    if (!row || row[stage] !== null || row.recovered_at !== null) {
      return { rows: [], rowCount: 0 };
    }
    row[stage] = NOW_ISO;
    return { rows: [{ id: row.id }], rowCount: 1 };
  }

  if (/UPDATE billing_dunning_cycles/i.test(sql) && /SET recovered_at/i.test(sql)) {
    // Two callers: markCyclesRecovered(orgId) closes every open cycle for an
    // org; the sweep closes ONE orphaned cycle by id.
    const byOrg = /WHERE organization_id/i.test(sql);
    const [key] = params as [string];
    // Matches the statement: NOT gated on lapsed_at, because a cycle that
    // reached lockout and then recovered is a recovered cycle.
    const hit = CYCLES.rows.filter(
      (r) => (byOrg ? r.organization_id === key : r.id === key) && r.recovered_at === null
    );
    hit.forEach((r) => { r.recovered_at = NOW_ISO; });
    return { rows: hit.map((r) => ({ id: r.id })), rowCount: hit.length };
  }

  if (/UPDATE billing_dunning_cycles/i.test(sql) && /SET lapsed_at/i.test(sql)) {
    // Two callers, two predicates: markCycleLapsed(id) closes one cycle,
    // markCyclesLapsed(orgId) closes every open cycle for an org.
    const byOrg = /WHERE organization_id/i.test(sql);
    const [key] = params as [string];
    const hit = byOrg
      ? CYCLES.rows.filter(
          (r) => r.organization_id === key && r.lapsed_at === null && r.recovered_at === null
        )
      : CYCLES.rows.filter(
          (r) => r.id === key && r.lapsed_at === null && r.recovered_at === null
        );
    hit.forEach((r) => { r.lapsed_at = NOW_ISO; });
    return { rows: hit.map((r) => ({ id: r.id })), rowCount: hit.length };
  }

  return queryMock(sql, params);
});
