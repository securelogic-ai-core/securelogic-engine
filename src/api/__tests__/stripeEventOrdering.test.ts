/**
 * stripeEventOrdering.test.ts — SL-BILL-1 PR-D (defects D5 and D6).
 *
 * WHAT THIS FILE PROTECTS: that Stripe's delivery order cannot decide a
 * customer's entitlement.
 *
 * Idempotency for DUPLICATES was already solid — `claimWebhookEvent` does an
 * atomic INSERT ... ON CONFLICT (provider, event_id) DO NOTHING and fails
 * closed. ORDERING was unprotected. Stripe does not guarantee delivery order,
 * nothing compared an incoming event against the state already applied, and the
 * one ordering guard in the handler (the superseded-subscription check on
 * customer.subscription.deleted) explicitly does not cover `.updated`.
 *
 * So a delayed `customer.subscription.updated(past_due)` landing AFTER the
 * recovery `active` silently downgraded a customer who had already paid: back
 * to 'starter', 403s across the gated surface, and nothing anywhere saying a
 * stale event caused it.
 *
 * THE ORDERING RULE under test (mirrored in the harness, defined in
 * stripeWebhook.ts):
 *
 *   watermark IS NULL                   → apply
 *   event.created > watermark           → apply
 *   event.created = watermark, same id  → suppress (duplicate)
 *   event.created = watermark, diff id  → apply (genuinely concurrent)
 *   event.created < watermark           → suppress (stale)
 *
 * The rule is symmetric: it guards revocations exactly as it guards grants.
 * Exempting revocations would preserve the "access can always be withdrawn"
 * instinct but re-open D5 outright, because D5 IS a stale revocation.
 *
 * Ordering is decided on STRIPE's clock (`event.created`), never on our receipt
 * time — receipt order is precisely the thing that goes wrong.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ORG, anOrg, resetCycles } from "./support/stripeWebhookHarness.js";

vi.mock("../infra/postgres.js", async () => {
  const { queryMock, elevatedQueryMock } = await import("./support/stripeWebhookHarness.js");
  return {
    pg: {
      query: (sql: string, params?: unknown[]) => queryMock(sql, params ?? []),
      connect: async () => ({
        query: (sql: string, params?: unknown[]) => queryMock(sql, params ?? []),
        release: () => {},
      }),
    },
    // billingDunningCycle.ts writes here: a provider callback has no tenant
    // scope, so the cycle row is written cross-org by design.
    pgElevated: {
      query: (sql: string, params?: unknown[]) => elevatedQueryMock(sql, params ?? []),
    },
  };
});

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

const T = 1_700_000_000;

/**
 * Deliver an event with an EXPLICIT (created, id). Every test here states both,
 * because the whole subject is what happens when arrival order and
 * `event.created` order disagree.
 */
async function deliver(
  created: number,
  id: string,
  event: Record<string, unknown>
): Promise<Record<string, unknown>> {
  NEXT_EVENT.value = { id, created, ...event };
  let body: Record<string, unknown> = {};
  const res = {
    status() { return res; },
    json(b: Record<string, unknown>) { body = b; return res; },
  };
  await stripeWebhook(
    { get: () => "t=1,v1=sig", rawBody: Buffer.from("{}") } as never,
    res as never
  );
  return body;
}

const PLATFORM_PRICE = "price_platform_env";

const subUpdated = (status: string, over: Record<string, unknown> = {}) => ({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_1", customer: "cus_1", status,
      metadata: { tier: "platform" },
      items: { data: [{ price: { id: PLATFORM_PRICE } }] },
      ...over,
    },
  },
});

const subDeleted = () => ({
  type: "customer.subscription.deleted",
  data: {
    object: {
      id: "sub_1", customer: "cus_1", status: "canceled", metadata: { tier: "platform" },
      items: { data: [{ price: { id: PLATFORM_PRICE } }] },
    },
  },
});

const paymentFailed = (over: Record<string, unknown> = {}) => ({
  type: "invoice.payment_failed",
  data: { object: { id: "in_1", customer: "cus_1", amount_due: 80000, subscription: "sub_1", ...over } },
});

const invoicePaid = () => ({
  type: "invoice.paid",
  data: {
    object: {
      id: "in_1", customer: "cus_1", paid: true, subscription: "sub_1",
      lines: { data: [{ price: { id: PLATFORM_PRICE } }] },
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  claimMock.mockResolvedValue({ firstSeen: true });
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_ID_PLATFORM = PLATFORM_PRICE;
  ORG.row = anOrg();
  resetCycles();
});

const suppressions = () =>
  (logger.warn as ReturnType<typeof vi.fn>).mock.calls
    .map(([ctx]) => ctx as { event?: string; reason?: string })
    .filter((c) => c.event === "stripe_webhook_event_suppressed");

/* ── D5: the stale event must not overwrite newer state ──────────────────── */

describe("D5 — a stale event cannot overwrite newer billing state", () => {
  it("a delayed past_due arriving AFTER the recovery active does NOT downgrade", async () => {
    // The exact production failure. The customer paid at T+200; the past_due
    // from T+100 is merely late.
    await deliver(T + 200, "evt_active", subUpdated("active"));
    expect(ORG.row.entitlement_level).toBe("premium");

    const body = await deliver(T + 100, "evt_past_due", subUpdated("past_due"));

    expect(body).toMatchObject({ updated: false, suppressed: "stale" });
    expect(ORG.row.entitlement_level).toBe("premium");
    expect(suppressions()[0]).toMatchObject({ reason: "stale" });
  });

  it("a delayed cancellation arriving after a newer active is suppressed too", async () => {
    // Symmetry is deliberate, and it is a TRADE-OFF, not an oversight: guarding
    // revocations is what closes D5, since D5 is a stale revocation. The cost is
    // that a genuinely-older cancellation arriving late is also suppressed. It
    // is logged at warn rather than applied silently.
    await deliver(T + 300, "evt_active", subUpdated("active"));

    const body = await deliver(T + 250, "evt_deleted", subDeleted());

    expect(body).toMatchObject({ suppressed: "stale" });
    expect(ORG.row.entitlement_level).toBe("premium");
    expect(suppressions()).toHaveLength(1);
  });

  it("a stale payment failure does not re-stamp a recovered org", async () => {
    await deliver(T + 400, "evt_paid", invoicePaid());
    expect(ORG.row.payment_failed_at).toBeNull();

    await deliver(T + 350, "evt_failed_late", paymentFailed());

    expect(ORG.row.payment_failed_at).toBeNull();
    expect((logger.warn as ReturnType<typeof vi.fn>).mock.calls.some(
      ([ctx]) => (ctx as { event?: string }).event === "stripe_payment_failed_not_stamped"
    )).toBe(true);
  });

  it("the Redis mirror is NOT written when the event is suppressed", async () => {
    // The mirror used to be written BEFORE the authoritative Postgres write, so
    // a suppressed event still poisoned the cache.
    await deliver(T + 500, "evt_active", subUpdated("active", { metadata: { tier: "platform", api_key_id: "11111111-1111-4111-8111-111111111111" } }));
    redisMock.mockClear();

    await deliver(T + 450, "evt_past_due", subUpdated("past_due", { metadata: { tier: "platform", api_key_id: "11111111-1111-4111-8111-111111111111" } }));

    expect(redisMock).not.toHaveBeenCalled();
  });
});

/* ── Legitimate progression must still advance ───────────────────────────── */

describe("newer events still advance state", () => {
  it("the ordinary failure → recovery sequence applies at every step", async () => {
    await deliver(T + 10, "evt_1", paymentFailed());
    expect(ORG.row.payment_failed_at).not.toBeNull();

    await deliver(T + 20, "evt_2", subUpdated("past_due"));
    expect(ORG.row.entitlement_level).toBe("starter");

    await deliver(T + 30, "evt_3", invoicePaid());
    expect(ORG.row.entitlement_level).toBe("premium");
    expect(ORG.row.payment_failed_at).toBeNull();

    await deliver(T + 40, "evt_4", subUpdated("active"));
    expect(ORG.row.entitlement_level).toBe("premium");

    expect(suppressions()).toHaveLength(0);
  });

  it("a recovery advances state even when it shares a second with the downgrade", async () => {
    // Same event.created, different event ids. Stripe exposes no finer ordering
    // signal, so the tie APPLIES — suppressing it would risk dropping a
    // legitimate recovery, which is the failure this package exists to prevent.
    await deliver(T + 60, "evt_past_due", subUpdated("past_due"));
    expect(ORG.row.entitlement_level).toBe("starter");

    const body = await deliver(T + 60, "evt_paid", invoicePaid());

    expect(body).toMatchObject({ restored: true });
    expect(ORG.row.entitlement_level).toBe("premium");
  });

  it("a cancellation newer than the last applied event still revokes", async () => {
    await deliver(T + 70, "evt_active", subUpdated("active"));

    await deliver(T + 80, "evt_deleted", subDeleted());

    expect(ORG.row.entitlement_level).toBe("starter");
  });

  it("the first event ever seen applies against a NULL watermark", async () => {
    // Every pre-existing row starts NULL — no backfill. Inventing a watermark
    // for historical rows would suppress a legitimate next event.
    ORG.row = anOrg({ stripe_billing_event_at: null, stripe_billing_event_id: null });

    await deliver(T - 100_000, "evt_old_but_first", subUpdated("active"));

    expect(ORG.row.entitlement_level).toBe("premium");
    expect(ORG.row.stripe_billing_event_id).toBe("evt_old_but_first");
  });
});

/* ── Duplicates ──────────────────────────────────────────────────────────── */

describe("duplicate delivery is idempotent", () => {
  it("the idempotency gate short-circuits a re-delivered event before any write", async () => {
    await deliver(T + 90, "evt_past_due", subUpdated("past_due"));
    expect(ORG.row.entitlement_level).toBe("starter");
    await deliver(T + 95, "evt_paid", invoicePaid());
    expect(ORG.row.entitlement_level).toBe("premium");

    claimMock.mockResolvedValue({ firstSeen: false });
    const body = await deliver(T + 90, "evt_past_due", subUpdated("past_due"));

    expect(body).toMatchObject({ idempotent_replay: true });
    expect(ORG.row.entitlement_level).toBe("premium");
  });

  it("the WRITE is idempotent even if the idempotency gate is bypassed", async () => {
    // Belt and braces on purpose: the ordering predicate makes a re-applied
    // event a no-op at the statement level, so the guarantee does not rest on
    // claimWebhookEvent alone.
    await deliver(T + 110, "evt_dup", subUpdated("active"));
    const after = { ...ORG.row };

    const body = await deliver(T + 110, "evt_dup", subUpdated("active"));

    expect(body).toMatchObject({ suppressed: "duplicate" });
    expect(ORG.row).toEqual(after);
    expect(suppressions()[0]).toMatchObject({ reason: "duplicate" });
  });
});

/* ── D6: the payment-failure stamp needs a subscription guard ────────────── */

describe("D6 — a superseded subscription's invoice must not stamp the org", () => {
  it("ignores a failed invoice belonging to a different subscription", async () => {
    ORG.row = anOrg({ stripe_subscription_id: "sub_current" });

    await deliver(T + 120, "evt_failed_old_sub", paymentFailed({ subscription: "sub_superseded" }));

    expect(ORG.row.payment_failed_at).toBeNull();
  });

  it("still stamps when the invoice carries no subscription reference", async () => {
    // The guard bites only when BOTH sides are known — otherwise a payload
    // shape we do not recognise would silently stop dunning altogether.
    await deliver(T + 130, "evt_failed_no_sub", {
      type: "invoice.payment_failed",
      data: { object: { id: "in_2", customer: "cus_1", amount_due: 80000 } },
    });

    expect(ORG.row.payment_failed_at).not.toBeNull();
  });

  it("still stamps when the org has no stored subscription id", async () => {
    ORG.row = anOrg({ stripe_subscription_id: null });

    await deliver(T + 140, "evt_failed", paymentFailed());

    expect(ORG.row.payment_failed_at).not.toBeNull();
  });
});

/* ── State advancement is independent of notification ────────────────────── */

describe("state advancement is not coupled to email delivery", () => {
  it("no email is sent on any ordering decision", async () => {
    const { sendEmail } = await import("../infra/email.js");

    await deliver(T + 150, "evt_active", subUpdated("active"));
    await deliver(T + 145, "evt_stale", subUpdated("past_due"));
    await deliver(T + 160, "evt_paid", invoicePaid());

    expect(sendEmail).not.toHaveBeenCalled();
    expect(ORG.row.entitlement_level).toBe("premium");
  });
});
