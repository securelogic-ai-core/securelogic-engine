/**
 * stripeRecoveryConvergence.test.ts — SL-BILL-1 PR-C (defect D4).
 *
 * WHAT THIS FILE PROTECTS: that a customer who has PAID gets their product
 * back. Entitlement used to be restored only by a
 * customer.subscription.updated(active) whose tier resolveTier could resolve.
 * When it could not — a subscription created outside our own Checkout carries
 * no tier metadata, and an unmapped price ID resolves to null — the handler
 * responded {ignored: true} and wrote nothing, anywhere. The org sat at
 * 'starter' with payment_failed_at set while holding a live, fully paid Stripe
 * subscription, and `invoice.paid` was not handled, so there was no second
 * chance. That is a paying customer locked out of the product permanently.
 *
 * These are BEHAVIOURAL tests, not source-shape tests: the exported
 * `stripeWebhook` handler is driven with real event payloads. Postgres is
 * simulated at the parameter level — the mock applies the same COALESCE /
 * clear-on-grant semantics as the real UPDATE — so the assertions are about
 * the state an org ENDS IN after a webhook sequence, which is the contract
 * that matters and the one no source-shape test can hold.
 *
 * Both invoice payload shapes are exercised. Which one Stripe sends is decided
 * by the API version configured on the webhook ENDPOINT in the Dashboard,
 * which has no representation in this repo and has not been verified, so the
 * code reads both and so does this file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Simulated organizations row ─────────────────────────────────────────── */

type OrgRow = {
  id: string;
  entitlement_level: string | null;
  plan: string | null;
  payment_failed_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_subscription_tier: string | null;
  max_monitored_entities: number | null;
  max_members: number | null;
};

const ORG: { row: OrgRow } = { row: null as unknown as OrgRow };

function anOrg(over: Partial<OrgRow> = {}): OrgRow {
  return {
    id: "org-1",
    entitlement_level: "premium",
    plan: "premium",
    payment_failed_at: null,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    stripe_subscription_status: "active",
    stripe_subscription_tier: "platform",
    max_monitored_entities: 50,
    max_members: 10,
    ...over,
  };
}

/**
 * The mock speaks the same SQL the handler writes. The UPDATE arm mirrors the
 * real statement's semantics exactly: COALESCE on the Stripe mirror columns,
 * and payment_failed_at cleared ONLY when the grant is for an active
 * subscription ($7). Getting that arm wrong would make the whole file lie.
 */
const queryMock = vi.fn(async (sql: string, params: unknown[] = []) => {
  const org = ORG.row;

  if (/SELECT id\s+FROM organizations\s+WHERE stripe_customer_id/i.test(sql)) {
    return org && org.stripe_customer_id === params[0]
      ? { rows: [{ id: org.id }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  if (/FROM organizations WHERE id = \$1/i.test(sql) && /^\s*SELECT/i.test(sql)) {
    return org && org.id === params[0] ? { rows: [org], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  if (/UPDATE organizations/i.test(sql) && /SET entitlement_level/i.test(sql)) {
    const [level, orgId, customerId, subId, rawTier, status, clearFailed] = params as [
      string, string, string | null, string | null, string | null, string | null, boolean
    ];
    if (!org || org.id !== orgId) return { rows: [], rowCount: 0 };
    org.entitlement_level = level;
    org.plan = level;
    org.stripe_customer_id = org.stripe_customer_id ?? customerId;
    org.stripe_subscription_id = subId ?? org.stripe_subscription_id;
    org.stripe_subscription_tier = rawTier ?? org.stripe_subscription_tier;
    org.stripe_subscription_status = status ?? org.stripe_subscription_status;
    if (clearFailed) org.payment_failed_at = null;
    return { rows: [], rowCount: 1 };
  }

  if (/UPDATE organizations/i.test(sql) && /SET payment_failed_at = NOW\(\)/i.test(sql)) {
    if (!org || org.stripe_customer_id !== params[0]) return { rows: [], rowCount: 0 };
    org.payment_failed_at = "2026-08-20T00:00:00.000Z";
    return { rows: [], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
});

const fakeClient = {
  query: (sql: string, params?: unknown[]) => queryMock(sql, params ?? []),
  release: vi.fn(),
};

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: (sql: string, params?: unknown[]) => queryMock(sql, params ?? []),
    connect: async () => fakeClient,
  },
}));

vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const redisMock = vi.fn(async () => {});
vi.mock("../infra/entitlementStore.js", () => ({
  setEntitlementInRedis: (...a: unknown[]) => redisMock(...(a as [])),
}));

const claimMock = vi.fn(async () => ({ firstSeen: true }));
vi.mock("./../webhooks/webhookIdempotency.js", () => ({
  claimWebhookEvent: (...a: unknown[]) => claimMock(...(a as [])),
}));

vi.mock("../lib/briefPlatformCredit.js", () => ({ applyBriefToPlatformCredit: vi.fn(async () => {}) }));
vi.mock("../infra/email.js", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

// constructEvent returns whatever the test queued; signature verification is
// Stripe's own code and is not what these tests are about.
const NEXT_EVENT: { value: unknown } = { value: null };
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => NEXT_EVENT.value },
    subscriptions: { list: async () => ({ data: [] }) },
  }),
}));

import { stripeWebhook } from "../webhooks/stripeWebhook.js";
import { logger } from "../infra/logger.js";

/* ── Driving the handler ─────────────────────────────────────────────────── */

let eventSeq = 0;

async function deliver(event: Record<string, unknown>): Promise<Record<string, unknown>> {
  NEXT_EVENT.value = { id: `evt_${++eventSeq}`, created: 1_700_000_000 + eventSeq, ...event };
  const req = {
    get: (h: string) => (h.toLowerCase() === "stripe-signature" ? "t=1,v1=sig" : undefined),
    rawBody: Buffer.from("{}"),
  } as never;
  let body: Record<string, unknown> = {};
  const res = {
    status() { return res; },
    json(b: Record<string, unknown>) { body = b; return res; },
  } as never as { status: () => unknown; json: (b: Record<string, unknown>) => unknown };
  await stripeWebhook(req, res as never);
  return body;
}

/** invoice.payment_failed — Stripe's opening move. */
const paymentFailed = () => ({
  type: "invoice.payment_failed",
  data: { object: { id: "in_1", customer: "cus_1", amount_due: 80000 } },
});

/**
 * customer.subscription.updated(past_due) with a price ID that is NOT in the
 * env-configured map and no tier metadata — the unresolvable case. Revocation
 * deliberately does not consult the tier, so this still downgrades.
 */
const pastDueUnresolvable = () => ({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_1", customer: "cus_1", status: "past_due", metadata: {},
      items: { data: [{ price: { id: "price_not_in_env" } }] },
    },
  },
});

/** The recovery event, pre-Basil payload shape. */
const invoicePaidLegacyShape = (over: Record<string, unknown> = {}) => ({
  type: "invoice.paid",
  data: {
    object: {
      id: "in_1", customer: "cus_1", paid: true, subscription: "sub_1",
      lines: { data: [{ price: { id: "price_not_in_env" } }] },
      ...over,
    },
  },
});

/** The recovery event, Basil payload shape. */
const invoicePaidBasilShape = (over: Record<string, unknown> = {}) => ({
  type: "invoice.paid",
  data: {
    object: {
      id: "in_1", customer: "cus_1", paid: true,
      parent: { subscription_details: { subscription: "sub_1", metadata: {} } },
      lines: { data: [{ pricing: { price_details: { price: "price_not_in_env" } } }] },
      ...over,
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  claimMock.mockResolvedValue({ firstSeen: true });
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  ORG.row = anOrg();
});

/* ── The defect ──────────────────────────────────────────────────────────── */

describe("D4 — the unresolvable-tier lockout", () => {
  it("subscription.updated(active) alone does NOT converge when the tier is unresolvable", async () => {
    // This is the pre-existing behaviour, asserted so the reason PR-C exists
    // cannot quietly disappear. It is NOT a bug being introduced here: refusing
    // to guess a tier is correct. The bug was having no other way back.
    ORG.row = anOrg({ entitlement_level: "starter", plan: "starter", payment_failed_at: "2026-08-20T00:00:00.000Z" });

    const body = await deliver({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1", customer: "cus_1", status: "active", metadata: {},
          items: { data: [{ price: { id: "price_not_in_env" } }] },
        },
      },
    });

    expect(body).toMatchObject({ ignored: true });
    expect(ORG.row.entitlement_level).toBe("starter");
    expect(ORG.row.payment_failed_at).not.toBeNull();
  });
});

/* ── The fix ─────────────────────────────────────────────────────────────── */

describe("PR-C — invoice.paid converges the full failure → recovery sequence", () => {
  it("payment_failed → past_due → invoice.paid restores entitlement AND clears the stamp", async () => {
    await deliver(paymentFailed());
    expect(ORG.row.payment_failed_at).not.toBeNull();

    await deliver(pastDueUnresolvable());
    expect(ORG.row.entitlement_level).toBe("starter");

    const body = await deliver(invoicePaidLegacyShape());

    expect(body).toMatchObject({ restored: true });
    expect(ORG.row.entitlement_level).toBe("premium");
    expect(ORG.row.payment_failed_at).toBeNull();
  });

  it("converges on the Basil invoice payload shape too", async () => {
    await deliver(paymentFailed());
    await deliver(pastDueUnresolvable());
    expect(ORG.row.entitlement_level).toBe("starter");

    const body = await deliver(invoicePaidBasilShape());

    expect(body).toMatchObject({ restored: true });
    expect(ORG.row.entitlement_level).toBe("premium");
    expect(ORG.row.payment_failed_at).toBeNull();
  });

  it("restores the Brief tier, not the platform tier, for a Brief subscriber", async () => {
    ORG.row = anOrg({
      entitlement_level: "starter", plan: "starter",
      payment_failed_at: "2026-08-20T00:00:00.000Z",
      stripe_subscription_tier: "professional",
    });

    await deliver(invoicePaidLegacyShape());

    expect(ORG.row.entitlement_level).toBe("professional");
    expect(ORG.row.payment_failed_at).toBeNull();
  });

  it("prefers the invoice's own price over the stored tier", async () => {
    // The stored tier says Brief; the paid invoice says Platform. What was just
    // paid for wins — otherwise a portal upgrade that fails and then recovers
    // would silently restore the OLD plan.
    process.env.STRIPE_PRICE_ID_PLATFORM = "price_platform_env";
    vi.resetModules();
    const { stripeWebhook: freshHandler } = await import("../webhooks/stripeWebhook.js");

    ORG.row = anOrg({
      entitlement_level: "starter", plan: "starter",
      payment_failed_at: "2026-08-20T00:00:00.000Z",
      stripe_subscription_tier: "professional",
    });

    NEXT_EVENT.value = {
      id: "evt_price", created: 1_700_001_000,
      ...invoicePaidLegacyShape({ lines: { data: [{ price: { id: "price_platform_env" } }] } }),
    };
    let body: Record<string, unknown> = {};
    await freshHandler(
      { get: () => "t=1,v1=sig", rawBody: Buffer.from("{}") } as never,
      { status() { return this; }, json(b: Record<string, unknown>) { body = b; return this; } } as never
    );

    expect(body).toMatchObject({ restored: true });
    expect(ORG.row.entitlement_level).toBe("premium");
    expect(ORG.row.stripe_subscription_tier).toBe("platform");
    delete process.env.STRIPE_PRICE_ID_PLATFORM;
  });

  it("is idempotent across the invoice.paid / invoice.payment_succeeded pair", async () => {
    ORG.row = anOrg({ entitlement_level: "starter", plan: "starter", payment_failed_at: "2026-08-20T00:00:00.000Z" });

    await deliver(invoicePaidLegacyShape());
    const afterFirst = { ...ORG.row };

    await deliver({ ...invoicePaidLegacyShape(), type: "invoice.payment_succeeded" });

    expect(ORG.row).toEqual(afterFirst);
    // Counted once: the second event observes an already-healthy org.
    const recovered = (logger.info as ReturnType<typeof vi.fn>).mock.calls
      .map(([ctx]) => ctx as { event?: string; wasDelinquent?: boolean })
      .filter((c) => c.event === "stripe_payment_recovered");
    expect(recovered.map((c) => c.wasDelinquent)).toEqual([true, false]);
  });
});

/* ── Guards: a paid invoice must not resurrect the wrong thing ───────────── */

describe("PR-C staleness and safety guards", () => {
  it("ignores an invoice with no subscription behind it", async () => {
    ORG.row = anOrg({ entitlement_level: "starter", plan: "starter", payment_failed_at: "2026-08-20T00:00:00.000Z" });

    const body = await deliver({
      type: "invoice.paid",
      data: { object: { id: "in_oneoff", customer: "cus_1", paid: true, lines: { data: [] } } },
    });

    expect(body).toMatchObject({ restored: false, reason: "not_subscription_invoice" });
    expect(ORG.row.entitlement_level).toBe("starter");
  });

  it("ignores an invoice for a superseded subscription", async () => {
    ORG.row = anOrg({
      entitlement_level: "starter", plan: "starter",
      payment_failed_at: "2026-08-20T00:00:00.000Z",
      stripe_subscription_id: "sub_current",
    });

    const body = await deliver(invoicePaidLegacyShape({ subscription: "sub_old" }));

    expect(body).toMatchObject({ restored: false, reason: "superseded" });
    expect(ORG.row.entitlement_level).toBe("starter");
  });

  it("does not resurrect an org whose subscription is already terminal", async () => {
    ORG.row = anOrg({
      entitlement_level: "starter", plan: "starter",
      stripe_subscription_status: "canceled",
    });

    const body = await deliver(invoicePaidLegacyShape());

    expect(body).toMatchObject({ restored: false, reason: "terminal_status" });
    expect(ORG.row.entitlement_level).toBe("starter");
  });

  it("ignores an invoice whose customer resolves to no organization", async () => {
    ORG.row = anOrg({ stripe_customer_id: "cus_other" });

    const body = await deliver(invoicePaidLegacyShape());

    expect(body).toMatchObject({ restored: false, reason: "org_not_resolved" });
  });

  it("fails VISIBLE when the tier cannot be resolved: no restore, and the stamp is KEPT", async () => {
    // Clearing the stamp here would delete the customer's only in-product
    // signal while leaving them downgraded — worse than the defect it fixes.
    ORG.row = anOrg({
      entitlement_level: "starter", plan: "starter",
      payment_failed_at: "2026-08-20T00:00:00.000Z",
      stripe_subscription_tier: null,
    });

    const body = await deliver(invoicePaidLegacyShape());

    expect(body).toMatchObject({ restored: false, reason: "tier_unresolved" });
    expect(ORG.row.entitlement_level).toBe("starter");
    expect(ORG.row.payment_failed_at).not.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "stripe_recovery_tier_unresolved", orgId: "org-1" }),
      expect.any(String)
    );
  });

  it("a duplicate event id is still short-circuited before any recovery write", async () => {
    ORG.row = anOrg({ entitlement_level: "starter", plan: "starter", payment_failed_at: "2026-08-20T00:00:00.000Z" });
    claimMock.mockResolvedValue({ firstSeen: false });

    const body = await deliver(invoicePaidLegacyShape());

    expect(body).toMatchObject({ idempotent_replay: true });
    expect(ORG.row.entitlement_level).toBe("starter");
  });
});
