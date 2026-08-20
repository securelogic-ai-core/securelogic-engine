/**
 * billingCheckoutResubscribe.test.ts — the Checkout half of the
 * suspended → Checkout → paid → restored path (SL-BILL-1 PR-H).
 *
 * Two properties that decide whether a returning customer gets their existing
 * organization back or a second empty one, and one dead end that was blocking
 * them from paying at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const elevatedQuery = vi.fn();
const customersCreate = vi.fn();
const sessionsCreate = vi.fn();

vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: (...a: unknown[]) => elevatedQuery(...a) },
  pg: { query: (...a: unknown[]) => elevatedQuery(...a) },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    customers: { create: (...a: unknown[]) => customersCreate(...a) },
    checkout: { sessions: { create: (...a: unknown[]) => sessionsCreate(...a) } },
    subscriptions: { retrieve: vi.fn() },
  }),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).apiKey = {
      id: "22222222-2222-4222-8222-222222222222",
      label: "key",
      organization_id: "org-1",
    };
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).organizationContext = { organizationId: "org-1" };
    next();
  },
}));

import router from "../routes/billing.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", router);
  return a;
}

/** A suspended org: cancelled subscription, existing Stripe customer, trial used. */
function suspendedOrg(over: Record<string, unknown> = {}) {
  elevatedQuery.mockImplementation(async (sql: string) => {
    if (/SELECT stripe_customer_id FROM organizations/i.test(sql)) {
      return { rows: [{ stripe_customer_id: over.customerId ?? "cus_existing" }], rowCount: 1 };
    }
    if (/SELECT trial_started_at FROM organizations/i.test(sql)) {
      // `in`, not `??` — passing null must MEAN null (never trialed), which is
      // exactly the case the first-time-trial test needs.
      const started = "trialStartedAt" in over ? over.trialStartedAt : "2026-01-01T00:00:00Z";
      return { rows: [{ trial_started_at: started }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

const checkout = (tier = "platform") =>
  request(app()).post("/api/billing/checkout").send({ tier });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_PRICE_ID_PLATFORM = "price_platform";
  process.env.STRIPE_PRICE_ID_PROFESSIONAL = "price_pro";
  delete process.env.SECURELOGIC_PLATFORM_TRIAL_ENABLED;
  sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
});

describe("re-subscription reuses the existing tenant", () => {
  it("does NOT create a second Stripe customer for an org that has one", async () => {
    // A new customer would orphan the org from its own billing history: the
    // webhook resolves organizations by stripe_customer_id, so the next
    // lifecycle event would fail to find the org it belongs to.
    suspendedOrg();

    const res = await checkout();

    expect(res.status).toBe(200);
    expect(customersCreate).not.toHaveBeenCalled();
    expect(sessionsCreate.mock.calls[0]![0]).toMatchObject({ customer: "cus_existing" });
  });

  it("carries organization_id on BOTH the session and the subscription", async () => {
    // subscription_data.metadata is what every later lifecycle event sees. The
    // session metadata alone would leave renewals and cancellations unable to
    // resolve the org except by customer id.
    suspendedOrg();

    await checkout();

    const args = sessionsCreate.mock.calls[0]![0] as Record<string, never>;
    expect(args.metadata).toMatchObject({ organization_id: "org-1", tier: "platform" });
    expect((args.subscription_data as Record<string, unknown>).metadata)
      .toMatchObject({ organization_id: "org-1", tier: "platform" });
  });

  it("is reachable by a SUSPENDED org — no entitlement gate on the way back in", async () => {
    // requireEntitlement on this route would lock a downgraded customer out of
    // the only path that can restore them.
    const source = (await import("fs")).readFileSync(
      new URL("../routes/billing.ts", import.meta.url), "utf8");
    const route = source.slice(source.indexOf('router.post("/billing/checkout"'));

    expect(route.slice(0, 200)).not.toMatch(/requireEntitlement/);
  });
});

describe("the trial dead end on the re-subscription path", () => {
  it("still refuses a SECOND trial — the one-per-org policy is unchanged", async () => {
    process.env.SECURELOGIC_PLATFORM_TRIAL_ENABLED = "true";
    suspendedOrg();

    const res = await checkout("platform");

    expect(res.status).toBe(200);
    const args = sessionsCreate.mock.calls[0]![0] as Record<string, never>;
    expect((args.subscription_data as Record<string, unknown>).trial_period_days).toBeUndefined();
  });

  it("no longer 409s a returning customer who is trying to pay", async () => {
    // This was a dead end: the 409 told them to subscribe "from Manage
    // Billing", and the Stripe portal has nothing to manage for a cancelled
    // subscription. We were refusing money to enforce a policy that dropping
    // the trial already enforces.
    process.env.SECURELOGIC_PLATFORM_TRIAL_ENABLED = "true";
    suspendedOrg();

    const res = await checkout("platform");

    expect(res.status).not.toBe(409);
    expect(res.body.checkoutUrl).toContain("checkout.stripe.com");
  });

  it("a FIRST-time trial is still granted", async () => {
    process.env.SECURELOGIC_PLATFORM_TRIAL_ENABLED = "true";
    suspendedOrg({ trialStartedAt: null });

    await checkout("platform");

    const args = sessionsCreate.mock.calls[0]![0] as Record<string, never>;
    expect((args.subscription_data as Record<string, unknown>).trial_period_days).toBe(14);
  });

  it("Brief tiers never carry a trial, before or after", async () => {
    process.env.SECURELOGIC_PLATFORM_TRIAL_ENABLED = "true";
    suspendedOrg({ trialStartedAt: null });

    await checkout("professional");

    const args = sessionsCreate.mock.calls[0]![0] as Record<string, never>;
    expect((args.subscription_data as Record<string, unknown>).trial_period_days).toBeUndefined();
  });
});
