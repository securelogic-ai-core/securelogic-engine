/**
 * billingGracePeriod.test.ts — SL-BILL-1 PR-F.
 *
 * Three things have to hold, and the third is the one that makes the whole
 * architecture defensible.
 *
 *   1. WITH THE FLAG OFF, NOTHING CHANGES. past_due revokes on the first failed
 *      charge, exactly as it does today, and the derived enforcement is inert.
 *      A dark feature that quietly alters behaviour is worse than no feature.
 *
 *   2. WITH THE FLAG ON, past_due stops revoking. Stripe is still trying to
 *      collect for another two weeks; withdrawing the product on the first
 *      failed charge while the processor is still working is the
 *      involuntary-churn machine this package exists to switch off.
 *
 *   3. ENFORCEMENT IS DERIVED, NOT SWEPT. A lapsed organization is denied on
 *      the very next request even if the sweep has never run — that property is
 *      why the sweep can be a small in-process worker instead of dedicated
 *      infrastructure, so it is tested directly rather than assumed.
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
const sendEmailMock = vi.fn(async () => ({ ok: true, id: "m" }));
vi.mock("../infra/email.js", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...(a as [])) }));

const NEXT_EVENT: { value: unknown } = { value: null };
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => NEXT_EVENT.value },
    subscriptions: { list: async () => ({ data: [] }) },
  }),
}));

import { stripeWebhook } from "../webhooks/stripeWebhook.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { effectiveEntitlementLevel } from "../lib/graceWindow.js";
import { logger } from "../infra/logger.js";

const T = Math.floor(Date.now() / 1000);
const PRICE = "price_platform_env";
const DAY = 86_400_000;

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
const subUpdated = (status: string) => ({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_1", customer: "cus_1", status, metadata: { tier: "platform" },
      items: { data: [{ price: { id: PRICE } }] },
    },
  },
});

/** Run the middleware and return the context it attached. */
async function contextFor(): Promise<Record<string, unknown>> {
  const req: Record<string, unknown> = { apiKey: { organization_id: "org-1" } };
  const res = { status() { return res; }, json() { return res; } };
  await attachOrganizationContext(req as never, res as never, () => {});
  return req.organizationContext as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ ok: true, id: "m" });
  claimMock.mockResolvedValue({ firstSeen: true });
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_ID_PLATFORM = PRICE;
  delete process.env.SECURELOGIC_BILLING_GRACE_ENABLED;
  delete process.env.SECURELOGIC_BILLING_GRACE_DAYS;
  ORG.row = anOrg();
  resetCycles();
});

/* ── 1. Flag off is a true no-op ─────────────────────────────────────────── */

describe("grace OFF — today's behaviour, unchanged", () => {
  it("past_due still revokes on the first failed charge", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 10, "evt_past_due", subUpdated("past_due"));

    expect(ORG.row.entitlement_level).toBe("starter");
  });

  it("the derived enforcement is inert — the stored level is what is enforced", async () => {
    // The window between invoice.payment_failed and the past_due update is the
    // trap: graceState() already reports `lapsed` there, so deriving
    // unconditionally would pull the lockout EARLIER than it happens today.
    ORG.row = anOrg({
      entitlement_level: "premium",
      payment_failed_at: new Date(Date.now() - 30 * DAY).toISOString(),
      stripe_subscription_status: "past_due",
    });

    const ctx = await contextFor();

    expect(ctx.entitlementLevel).toBe("premium");
  });

  it("effectiveEntitlementLevel returns the stored level regardless of age", () => {
    const ancient = new Date(Date.now() - 400 * DAY);
    expect(
      effectiveEntitlementLevel("premium", { paymentFailedAt: ancient }, new Date(), {} as NodeJS.ProcessEnv)
    ).toBe("premium");
  });
});

/* ── 2. Flag on: past_due no longer revokes ──────────────────────────────── */

describe("grace ON — the customer keeps working while Stripe retries", () => {
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_DAYS", "15");
  });

  it("past_due does NOT revoke", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 10, "evt_past_due", subUpdated("past_due"));

    expect(ORG.row.entitlement_level).toBe("premium");
  });

  it("full access during grace — the enforced level equals the stored one", async () => {
    ORG.row = anOrg({
      payment_failed_at: new Date(Date.now() - 3 * DAY).toISOString(),
      stripe_subscription_status: "past_due",
    });

    const ctx = await contextFor();

    expect(ctx.entitlementLevel).toBe("premium");
    expect(ctx.graceState).toBe("in_grace");
  });

  it("a TERMINAL state still revokes immediately, whatever the clock says", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 10, "evt_canceled", subUpdated("canceled"));

    expect(ORG.row.entitlement_level).toBe("starter");
  });

  it("subscription.deleted still revokes", async () => {
    await deliver(T, "evt_1", paymentFailed());
    await deliver(T + 10, "evt_del", {
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1", customer: "cus_1", status: "canceled", metadata: { tier: "platform" },
          items: { data: [{ price: { id: PRICE } }] },
        },
      },
    });

    expect(ORG.row.entitlement_level).toBe("starter");
  });
});

/* ── 3. Enforcement is derived, not swept ───────────────────────────────── */

describe("grace ON — a lapsed org is denied even if the sweep never ran", () => {
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_DAYS", "15");
  });

  it("enforces 'starter' while the STORED level is still premium", async () => {
    // The stored level is what the last Stripe event wrote. The sweep has not
    // run — this is precisely the state a missed, crashed or never-scheduled
    // job would leave behind, and access must still be correct.
    ORG.row = anOrg({
      entitlement_level: "premium",
      payment_failed_at: new Date(Date.now() - 16 * DAY).toISOString(),
      stripe_subscription_status: "past_due",
    });

    const ctx = await contextFor();

    expect(ctx.entitlementLevel).toBe("starter");
    expect(ctx.storedEntitlementLevel).toBe("premium");
    expect(ctx.graceState).toBe("lapsed");
  });

  it("logs the divergence rather than diverging silently", async () => {
    ORG.row = anOrg({
      entitlement_level: "premium",
      payment_failed_at: new Date(Date.now() - 20 * DAY).toISOString(),
      stripe_subscription_status: "past_due",
    });

    await contextFor();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "grace_window_enforced_below_stored",
        storedLevel: "premium",
        enforcedLevel: "starter",
      }),
      expect.any(String)
    );
  });

  it("day 14 is still inside the window; day 15 is not", async () => {
    const at = (days: number) =>
      effectiveEntitlementLevel(
        "premium",
        { paymentFailedAt: new Date(Date.now() - days * DAY), subscriptionStatus: "past_due" },
        new Date(),
        { SECURELOGIC_BILLING_GRACE_ENABLED: "true", SECURELOGIC_BILLING_GRACE_DAYS: "15" } as NodeJS.ProcessEnv
      );

    expect(at(14)).toBe("premium");
    expect(at(15)).toBe("starter");
    expect(at(16)).toBe("starter");
  });

  it("a healthy org is never downgraded by the derivation", async () => {
    ORG.row = anOrg({ entitlement_level: "premium", payment_failed_at: null });

    const ctx = await contextFor();

    expect(ctx.entitlementLevel).toBe("premium");
    expect(ctx.graceState).toBe("healthy");
  });
});
