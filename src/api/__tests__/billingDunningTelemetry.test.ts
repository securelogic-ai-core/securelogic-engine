/**
 * billingDunningTelemetry.test.ts — SL-BILL-1 PR-E.
 *
 * WHY THIS EXISTS: "did dunning work?" had no answer. `payment_failed_at` is a
 * single mutable flag that says an org is delinquent RIGHT NOW and nothing
 * about the outcome of any past delinquency — it is CLEARED on recovery, so an
 * org that failed, was warned, paid and carried on is indistinguishable from
 * one that never failed. "Our dunning saves customers" and "our dunning saves
 * nobody" were equally consistent with the data, and one of those conclusions
 * would wrongly justify cutting the emails.
 *
 * This file pins the event vocabulary that closes the gap. Each event carries
 * orgId and cycleId and fires ONCE PER CYCLE, not once per webhook — Stripe
 * sends up to eight failures and can report a recovery twice, so per-webhook
 * counting would inflate both sides of the ratio.
 *
 *   billing_dunning_started    — the denominator
 *   billing_dunning_notified   — the funnel
 *   billing_dunning_recovered  — the numerator
 *   billing_dunning_lapsed     — the other terminal outcome
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ORG, anOrg, CYCLES, resetCycles } from "./support/stripeWebhookHarness.js";

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
    pgElevated: {
      query: (sql: string, params?: unknown[]) => elevatedQueryMock(sql, params ?? []),
    },
  };
});

vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../infra/entitlementStore.js", () => ({ setEntitlementInRedis: vi.fn(async () => {}) }));

const claimMock = vi.fn(async () => ({ firstSeen: true }));
vi.mock("./../webhooks/webhookIdempotency.js", () => ({
  claimWebhookEvent: (...a: unknown[]) => claimMock(...(a as [])),
}));
vi.mock("../lib/briefPlatformCredit.js", () => ({ applyBriefToPlatformCredit: vi.fn(async () => {}) }));
vi.mock("../infra/email.js", () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: "m" })) }));

const NEXT_EVENT: { value: unknown } = { value: null };
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => NEXT_EVENT.value },
    subscriptions: { list: async () => ({ data: [] }) },
  }),
}));

import { stripeWebhook } from "../webhooks/stripeWebhook.js";
import { logger } from "../infra/logger.js";

const T = Math.floor(Date.now() / 1000);
const PRICE = "price_platform_env";

async function deliver(created: number, id: string, event: Record<string, unknown>) {
  NEXT_EVENT.value = { id, created, ...event };
  const res = { status() { return res; }, json() { return res; } };
  await stripeWebhook(
    { get: () => "t=1,v1=sig", rawBody: Buffer.from("{}") } as never,
    res as never
  );
}

const paymentFailed = () => ({
  type: "invoice.payment_failed",
  data: { object: { id: "in_1", customer: "cus_1", amount_due: 80000, subscription: "sub_1" } },
});
const invoicePaid = () => ({
  type: "invoice.paid",
  data: {
    object: {
      id: "in_1", customer: "cus_1", paid: true, subscription: "sub_1",
      lines: { data: [{ price: { id: PRICE } }] },
    },
  },
});
const subUpdated = (status: string) => ({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_1", customer: "cus_1", status, metadata: { tier: "platform" },
      items: { data: [{ price: { id: PRICE } }] },
    },
  },
});

/** Every structured event the logger saw, in order. */
function events(name: string) {
  const calls = [
    ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
    ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
  ];
  return calls
    .map(([ctx]) => ctx as Record<string, unknown>)
    .filter((c) => c?.event === name);
}

beforeEach(() => {
  vi.clearAllMocks();
  claimMock.mockResolvedValue({ firstSeen: true });
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_ID_PLATFORM = PRICE;
  ORG.row = anOrg();
  resetCycles();
});

describe("the denominator fires once per cycle, not once per retry", () => {
  it("eight failures produce ONE billing_dunning_started", async () => {
    for (let i = 1; i <= 8; i++) {
      await deliver(T + i * 172_800, `evt_${i}`, paymentFailed());
    }

    const started = events("billing_dunning_started");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ orgId: "org-1" });
    expect(started[0]!.cycleId).toBeTruthy();
  });

  it("a second delinquency after recovery opens a second cycle", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 100, "evt_paid", invoicePaid());
    await deliver(T + 9_000_000, "evt_2", paymentFailed());

    expect(events("billing_dunning_started")).toHaveLength(2);
  });
});

describe("the numerator fires once per cycle, not once per observation", () => {
  it("recovery observed twice is counted once", async () => {
    await deliver(T, "evt_1", paymentFailed());

    await deliver(T + 100, "evt_paid", invoicePaid());
    await deliver(T + 200, "evt_active", subUpdated("active"));

    const recovered = events("billing_dunning_recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ orgId: "org-1" });
  });
});

describe("the other terminal outcome closes the cycle", () => {
  it("a revocation stamps lapsed_at and emits billing_dunning_lapsed", async () => {
    await deliver(T, "evt_1", paymentFailed());

    await deliver(T + 100, "evt_past_due", subUpdated("past_due"));

    expect(CYCLES.rows[0]!.lapsed_at).not.toBeNull();
    const lapsed = events("billing_dunning_lapsed");
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0]).toMatchObject({ orgId: "org-1", subscriptionStatus: "past_due" });
  });

  it("a cycle only lapses once however many revocations arrive", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 100, "evt_past_due", subUpdated("past_due"));
    await deliver(T + 200, "evt_canceled", subUpdated("canceled"));

    expect(events("billing_dunning_lapsed")).toHaveLength(1);
  });

  it("recovery AFTER lockout still counts as recovered — the save that mattered most", async () => {
    // This is the case the rate must not drop. Gating markCyclesRecovered on
    // lapsed_at IS NULL would exclude precisely the customers dunning rescued.
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 100, "evt_past_due", subUpdated("past_due"));
    expect(CYCLES.rows[0]!.lapsed_at).not.toBeNull();

    await deliver(T + 200, "evt_paid", invoicePaid());

    expect(CYCLES.rows[0]!.recovered_at).not.toBeNull();
    expect(events("billing_dunning_recovered")).toHaveLength(1);
    // lapsed_at is KEPT, so the pair distinguishes recovered-before-lockout
    // from recovered-after-lockout.
    expect(CYCLES.rows[0]!.lapsed_at).not.toBeNull();
  });

  it("a healthy org's revocation emits nothing — no cycle, no event", async () => {
    await deliver(T, "evt_canceled", subUpdated("canceled"));

    expect(events("billing_dunning_lapsed")).toHaveLength(0);
  });
});

describe("the funnel", () => {
  it("the notification carries orgId, stage and the grace state it was written for", async () => {
    await deliver(T, "evt_1", paymentFailed());

    const notified = events("billing_dunning_notified");
    expect(notified.length).toBeGreaterThan(0);
    expect(notified[0]).toMatchObject({ orgId: "org-1", stage: 0, graceState: "lapsed" });
  });
});
