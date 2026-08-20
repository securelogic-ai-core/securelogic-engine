/**
 * billingResubscribeRecovery.test.ts — the suspended → Checkout → paid →
 * restored path, end to end (SL-BILL-1 PR-H).
 *
 * WHY THIS PATH NEEDS ITS OWN FILE. Under ruling P6 the end of dunning CANCELS
 * the Stripe subscription, and a canceled subscription cannot be revived by a
 * card update — the portal has nothing left to update. So the only way back for
 * a suspended customer is a NEW subscription through Checkout, against the SAME
 * organization. That is a different sequence from dunning recovery, it touches
 * the superseded-subscription guards from PR-C and PR-D, and nothing tested it.
 *
 * The seven properties proven here are the ones that decide whether a returning
 * customer gets their product and their history back, or a second empty tenant:
 *
 *   1. the existing organization is preserved (same id, no new row)
 *   2. no duplicate tenant / duplicate Stripe customer
 *   3. the canceled subscription relationship is REPLACED by the new one
 *   4. the correct entitlement is restored (tier-accurate, not just "paid")
 *   5. the delinquent state is cleared
 *   6. existing data is preserved — including admin-elevated caps
 *   7. the resulting /account state is healthy
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
const subscriptionsList = vi.fn(async () => ({ data: [] }));
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => NEXT_EVENT.value },
    subscriptions: { list: (...a: unknown[]) => subscriptionsList(...(a as [])) },
  }),
}));

import { stripeWebhook } from "../webhooks/stripeWebhook.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const T = Math.floor(Date.now() / 1000);
const PLATFORM = "price_platform_env";
const API_KEY_ID = "11111111-1111-4111-8111-111111111111";

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

/** The org a suspended customer actually has: starter, stamped, old sub id. */
function aSuspendedOrg(over: Record<string, unknown> = {}) {
  return anOrg({
    entitlement_level: "starter",
    plan: "starter",
    payment_failed_at: new Date((T - 20 * 86_400) * 1000).toISOString(),
    stripe_subscription_id: "sub_OLD",
    stripe_subscription_status: "canceled",
    stripe_subscription_tier: "platform",
    // An admin-elevated cap. The re-subscription must not silently reset it.
    max_monitored_entities: 500,
    max_members: 25,
    ...over,
  });
}

/** Stripe's sequence when a returning customer completes Checkout. */
const subscriptionCreated = (subId = "sub_NEW", tier = "platform", price = PLATFORM) => ({
  type: "customer.subscription.created",
  data: {
    object: {
      id: subId, customer: "cus_1", status: "active",
      metadata: { organization_id: "org-1", api_key_id: API_KEY_ID, tier },
      items: { data: [{ price: { id: price } }] },
    },
  },
});

const checkoutCompleted = (subId = "sub_NEW", tier = "platform") => ({
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1", customer: "cus_1", subscription: subId, mode: "subscription",
      metadata: { organization_id: "org-1", api_key_id: API_KEY_ID, tier },
    },
  },
});

const invoicePaidFor = (subId = "sub_NEW", price = PLATFORM) => ({
  type: "invoice.paid",
  data: {
    object: {
      id: "in_NEW", customer: "cus_1", paid: true, subscription: subId,
      billing_reason: "subscription_create",
      lines: { data: [{ price: { id: price } }] },
    },
  },
});

async function accountState(): Promise<Record<string, unknown>> {
  const req: Record<string, unknown> = { apiKey: { organization_id: "org-1" } };
  const res = { status() { return res; }, json() { return res; } };
  await attachOrganizationContext(req as never, res as never, () => {});
  return req.organizationContext as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ ok: true, id: "m" });
  claimMock.mockResolvedValue({ firstSeen: true });
  subscriptionsList.mockResolvedValue({ data: [] });
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_ID_PLATFORM = PLATFORM;
  delete process.env.SECURELOGIC_BILLING_GRACE_ENABLED;
  ORG.row = aSuspendedOrg();
  resetCycles();
  CYCLES.rows.push({
    id: "cycle-old", organization_id: "org-1",
    cycle_started_at: new Date((T - 20 * 86_400) * 1000).toISOString(),
    stripe_subscription_id: "sub_OLD", first_event_id: "evt_old",
    notified_day0_at: "x", notified_day7_at: "x", notified_day14_at: "x",
    recovered_at: null, lapsed_at: "x",
  });
});

/** The full Stripe sequence for a completed re-subscription checkout. */
async function resubscribe(tier = "platform", price = PLATFORM) {
  await deliver(T, "evt_sub_created", subscriptionCreated("sub_NEW", tier, price));
  await deliver(T + 1, "evt_checkout", checkoutCompleted("sub_NEW", tier));
  await deliver(T + 2, "evt_invoice_paid", invoicePaidFor("sub_NEW", price));
}

describe("suspended → Checkout → paid → restored", () => {
  it("1. preserves the existing organization", async () => {
    await resubscribe();

    expect(ORG.row.id).toBe("org-1");
    expect(ORG.row.stripe_customer_id).toBe("cus_1");
  });

  it("2. creates no duplicate tenant — one org row, one Stripe customer", async () => {
    const before = { ...ORG.row };

    await resubscribe();

    expect(ORG.row.id).toBe(before.id);
    expect(ORG.row.stripe_customer_id).toBe(before.stripe_customer_id);
  });

  it("3. replaces the canceled subscription relationship", async () => {
    await resubscribe();

    expect(ORG.row.stripe_subscription_id).toBe("sub_NEW");
  });

  it("3b. a LATE cancellation of the old subscription does not revoke the new one", async () => {
    // Stripe can deliver the old subscription's terminal event after the new
    // one exists. Without the superseded guard this would suspend a customer
    // who just paid.
    await resubscribe();

    const body = await deliver(T + 60, "evt_old_deleted", {
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_OLD", customer: "cus_1", status: "canceled",
          metadata: { tier: "platform" },
          items: { data: [{ price: { id: PLATFORM } }] },
        },
      },
    });

    expect(body).toMatchObject({ ignored: true, reason: "superseded" });
    expect(ORG.row.entitlement_level).toBe("premium");
  });

  it("4. restores the correct entitlement", async () => {
    await resubscribe();

    expect(ORG.row.entitlement_level).toBe("premium");
    expect(ORG.row.stripe_subscription_tier).toBe("platform");
  });

  it("4b. a returning customer who downgrades gets the tier they PAID for", async () => {
    // The org's stored tier still says platform from the old subscription. The
    // new subscription is Brief Pro; restoring 'premium' here would hand out
    // the platform for $49.
    process.env.STRIPE_PRICE_ID_PROFESSIONAL = "price_pro_env";
    await resubscribe("professional", "price_pro_env");

    expect(ORG.row.entitlement_level).toBe("professional");
    expect(ORG.row.stripe_subscription_tier).toBe("professional");
    delete process.env.STRIPE_PRICE_ID_PROFESSIONAL;
  });

  it("5. clears the delinquent state", async () => {
    await resubscribe();

    expect(ORG.row.payment_failed_at).toBeNull();
  });

  it("6. preserves existing data, including admin-elevated caps", async () => {
    await resubscribe();

    expect(ORG.row.max_monitored_entities).toBe(500);
    expect(ORG.row.max_members).toBe(25);
  });

  it("7. the resulting /account state is healthy", async () => {
    await resubscribe();

    const ctx = await accountState();

    expect(ctx.entitlementLevel).toBe("premium");
    expect(ctx.graceState).toBe("healthy");
    expect(ctx.paymentFailedAt).toBeNull();
  });
});

describe("the dunning cycle is not misattributed", () => {
  it("a re-subscription does NOT resurrect the old lapsed cycle as recovered", async () => {
    // The customer lapsed and came back with a NEW subscription weeks later.
    // Counting that as a dunning recovery would credit the emails with a sale
    // they did not make, and would put a 20-day gap into
    // median_hours_to_recovery.
    await resubscribe();

    const old = CYCLES.rows.find((c) => c.id === "cycle-old")!;
    expect(old.recovered_at).toBeNull();
    expect(old.lapsed_at).not.toBeNull();
  });
});
