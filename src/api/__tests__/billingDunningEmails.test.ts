/**
 * billingDunningEmails.test.ts — SL-BILL-1 PR-B.
 *
 * WHAT THIS FILE PROTECTS: that a customer whose card fails is TOLD, exactly
 * once per delinquency, in wording the platform can actually honour.
 *
 * Three defects live here, and they are easy to reintroduce:
 *
 *   1. EIGHT EMAILS. Stripe sends invoice.payment_failed on every retry — up to
 *      8 across a 2-week Smart Retries window. Emailing off the event sends the
 *      customer eight identical notices. The cycle row is the idempotency
 *      token, and under ruling R1 every retry carries the same
 *      cycle_started_at, so UNIQUE (organization_id, cycle_started_at) is what
 *      separates the opening failure from its retries.
 *
 *   2. A MOVING GRACE CLOCK. Before R1 the stamp was NOW() on every event, so
 *      its age never exceeded the gap between retries. Any grace period built
 *      on it would reset on every retry and a day-15 backstop could never fire.
 *
 *   3. A PROMISE THE PLATFORM DOESN'T KEEP. The copy is derived from
 *      graceState() — the same function that enforces grace at request time —
 *      so with the grace mechanism undeployed or flagged off, the email says
 *      "suspended" rather than promising access until a date that will not be
 *      honoured.
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

const sendEmailMock = vi.fn(async () => ({ ok: true, id: "msg_1" }));
vi.mock("../infra/email.js", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...(a as [])) }));

const NEXT_EVENT: { value: unknown } = { value: null };
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => NEXT_EVENT.value },
    subscriptions: { list: async () => ({ data: [] }) },
  }),
}));

import { stripeWebhook } from "../webhooks/stripeWebhook.js";

/* ── Driving the handler ─────────────────────────────────────────────────── */

// The cycle start is pinned to "now" rather than a literal date, because
// graceState() compares against the real clock: a hard-coded past timestamp
// would be outside the window and every grace-ON assertion would silently test
// the lapsed branch instead.
const T = Math.floor(Date.now() / 1000);
const GRACE_END_LABEL = new Date((T + 15 * 86_400) * 1000).toLocaleDateString("en-US", {
  month: "long", day: "numeric", year: "numeric",
});

async function deliver(created: number, id: string, event: Record<string, unknown>) {
  NEXT_EVENT.value = { id, created, ...event };
  let body: Record<string, unknown> = {};
  const res = { status() { return res; }, json(b: Record<string, unknown>) { body = b; return res; } };
  await stripeWebhook(
    { get: () => "t=1,v1=sig", rawBody: Buffer.from("{}") } as never,
    res as never
  );
  return body;
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
      lines: { data: [{ price: { id: "price_platform_env" } }] },
    },
  },
});

/** Recipients: two verified admins, one unverified user who must NOT be mailed. */
function seedAdmins() {
  const { queryMock } = harness;
  queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT email, name FROM users/i.test(sql)) {
      return { rows: [{ email: "a@example.com", name: "A" }, { email: "b@example.com", name: "B" }], rowCount: 2 };
    }
    if (/SELECT name FROM organizations WHERE id/i.test(sql)) {
      return { rows: [{ name: "Acme Health" }], rowCount: 1 };
    }
    return realQuery(sql, params);
  });
}

import * as harnessModule from "./support/stripeWebhookHarness.js";
const harness = harnessModule;
const realQuery = harnessModule.queryMock.getMockImplementation()!;

const subjects = () =>
  sendEmailMock.mock.calls.map(([a]) => (a as unknown as { subject: string }).subject);
const bodies = () =>
  sendEmailMock.mock.calls.map(([a]) => (a as unknown as { html: string }).html);

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets CALLS, not implementations — a mockRejectedValue set
  // by the email-failure test would otherwise leak into every later test.
  sendEmailMock.mockResolvedValue({ ok: true, id: "msg_1" });
  claimMock.mockResolvedValue({ firstSeen: true });
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_ID_PLATFORM = "price_platform_env";
  delete process.env.SECURELOGIC_BILLING_GRACE_ENABLED;
  delete process.env.SECURELOGIC_BILLING_GRACE_DAYS;
  ORG.row = anOrg();
  resetCycles();
  harnessModule.queryMock.mockImplementation(realQuery);
  seedAdmins();
});

/* ── R1: the cycle clock ─────────────────────────────────────────────────── */

describe("R1 — payment_failed_at is the cycle START, on Stripe's clock", () => {
  it("stamps the FIRST failure from event.created, not from our clock", async () => {
    await deliver(T, "evt_1", paymentFailed());

    expect(ORG.row.payment_failed_at).toBe(new Date(T * 1000).toISOString());
  });

  it("retries do NOT move the stamp", async () => {
    await deliver(T, "evt_1", paymentFailed());
    const cycleStart = ORG.row.payment_failed_at;

    // Three retries, each 2 days later — the real Smart Retries shape.
    await deliver(T + 172_800, "evt_2", paymentFailed());
    await deliver(T + 345_600, "evt_3", paymentFailed());
    await deliver(T + 518_400, "evt_4", paymentFailed());

    expect(ORG.row.payment_failed_at).toBe(cycleStart);
  });

  it("a recovery clears it, and the NEXT delinquency starts a fresh cycle", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 100, "evt_paid", invoicePaid());
    expect(ORG.row.payment_failed_at).toBeNull();

    await deliver(T + 9_000_000, "evt_later_fail", paymentFailed());

    expect(ORG.row.payment_failed_at).toBe(new Date((T + 9_000_000) * 1000).toISOString());
    expect(CYCLES.rows).toHaveLength(2);
  });
});

/* ── Exactly one Day-0 email per cycle ───────────────────────────────────── */

describe("PR-B — the customer is told, once", () => {
  it("emails every verified admin on the first failure", async () => {
    await deliver(T, "evt_1", paymentFailed());

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock.mock.calls.map(([a]) => (a as unknown as { to: string }).to))
      .toEqual(["a@example.com", "b@example.com"]);
    expect(subjects()[0]).toMatch(/Payment failed for Acme Health/);
  });

  it("sends NOTHING extra across seven retries", async () => {
    await deliver(T, "evt_1", paymentFailed());
    sendEmailMock.mockClear();

    for (let i = 2; i <= 8; i++) {
      await deliver(T + i * 172_800, `evt_${i}`, paymentFailed());
    }

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(CYCLES.rows).toHaveLength(1);
    expect(CYCLES.rows[0]!.notified_day0_at).not.toBeNull();
  });

  it("a new delinquency after recovery gets its own notice", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 100, "evt_paid", invoicePaid());
    sendEmailMock.mockClear();

    await deliver(T + 9_000_000, "evt_later_fail", paymentFailed());

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it("an email failure never changes the webhook response", async () => {
    sendEmailMock.mockRejectedValue(new Error("resend down"));

    const body = await deliver(T, "evt_1", paymentFailed());

    expect(body).toMatchObject({ received: true, updated: true });
    expect(ORG.row.payment_failed_at).not.toBeNull();
  });

  it("skips silently when the org has no verified admins", async () => {
    harnessModule.queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (/SELECT email, name FROM users/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT name FROM organizations WHERE id/i.test(sql)) return { rows: [{ name: "Acme" }], rowCount: 1 };
      return realQuery(sql, params);
    });

    const body = await deliver(T, "evt_1", paymentFailed());

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ updated: true });
  });
});

/* ── The copy cannot promise what the platform will not do ───────────────── */

describe("PR-B — grace-aware copy", () => {
  it("with grace OFF, says suspended and names NO date", async () => {
    await deliver(T, "evt_1", paymentFailed());

    expect(subjects()[0]).toMatch(/access suspended/i);
    expect(bodies()[0]).toMatch(/has been suspended/i);
    expect(bodies()[0]).not.toMatch(/continues until/i);
  });

  it("with grace ON, promises access until the derived date", async () => {
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_DAYS", "15");

    await deliver(T, "evt_1", paymentFailed());

    expect(bodies()[0]).toContain(`continues until <strong>${GRACE_END_LABEL}</strong>`);
    expect(subjects()[0]).toMatch(/action needed/i);
    vi.unstubAllEnvs();
  });

  it("with grace ON but the subscription already terminal, still says suspended", async () => {
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_ENABLED", "true");
    ORG.row = anOrg({ stripe_subscription_status: "unpaid" });

    await deliver(T, "evt_1", paymentFailed());

    expect(bodies()[0]).toMatch(/has been suspended/i);
    vi.unstubAllEnvs();
  });
});

/* ── Recovery confirmation ───────────────────────────────────────────────── */

describe("PR-B — the recovery confirmation closes the loop", () => {
  it("confirms once when the payment lands", async () => {
    await deliver(T, "evt_1", paymentFailed());
    sendEmailMock.mockClear();

    await deliver(T + 100, "evt_paid", invoicePaid());

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(subjects()[0]).toMatch(/Payment received — Acme Health access restored/);
    expect(CYCLES.rows[0]!.recovered_at).not.toBeNull();
  });

  it("does not confirm twice when recovery is observed again", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 100, "evt_paid", invoicePaid());
    sendEmailMock.mockClear();

    // A following subscription.updated(active) also restores entitlement.
    await deliver(T + 200, "evt_active", {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1", customer: "cus_1", status: "active", metadata: { tier: "platform" },
          items: { data: [{ price: { id: "price_platform_env" } }] },
        },
      },
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not confirm when there was no open cycle", async () => {
    await deliver(T, "evt_paid", invoicePaid());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
