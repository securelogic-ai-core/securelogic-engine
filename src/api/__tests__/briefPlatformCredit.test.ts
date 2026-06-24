import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// getStripe should never be called when a client is injected; make it throw so a
// regression that drops the injected client is caught loudly.
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => { throw new Error("getStripe() should not be called in unit tests"); },
}));

import {
  briefPlatformCreditEnabled,
  alreadyCredited,
  sumPaidInvoiceCents,
  firstYearPlatformCents,
  computeCreditCents,
  applyBriefToPlatformCredit,
  CREDIT_METADATA_KEY,
  CREDIT_REASON,
} from "../lib/briefPlatformCredit.js";

const FLAG = "SECURELOGIC_BRIEF_PLATFORM_CREDIT_ENABLED";
afterEach(() => { delete process.env[FLAG]; });

describe("briefPlatformCreditEnabled", () => {
  it("off by default, on only for the exact string 'true'", () => {
    expect(briefPlatformCreditEnabled({})).toBe(false);
    expect(briefPlatformCreditEnabled({ [FLAG]: "true" })).toBe(true);
    expect(briefPlatformCreditEnabled({ [FLAG]: "1" })).toBe(false);
    expect(briefPlatformCreditEnabled({ [FLAG]: "TRUE" })).toBe(false);
  });
});

describe("alreadyCredited", () => {
  it("is true iff a txn carries our marker metadata", () => {
    expect(alreadyCredited([])).toBe(false);
    expect(alreadyCredited([{ metadata: { foo: "bar" } }])).toBe(false);
    expect(alreadyCredited([{ metadata: { [CREDIT_METADATA_KEY]: CREDIT_REASON } }])).toBe(true);
    expect(alreadyCredited([{ metadata: null }, { metadata: { [CREDIT_METADATA_KEY]: "other" } }])).toBe(false);
  });
});

describe("sumPaidInvoiceCents", () => {
  it("sums amount_paid and captures currency, ignoring non-positive", () => {
    const r = sumPaidInvoiceCents([
      { amount_paid: 2900, currency: "usd" },
      { amount_paid: 2900, currency: "usd" },
      { amount_paid: 0, currency: "usd" },
      { amount_paid: null, currency: "usd" },
    ]);
    expect(r).toEqual({ cents: 5800, currency: "usd" });
  });
  it("defaults currency to usd when none present", () => {
    expect(sumPaidInvoiceCents([{ amount_paid: 100 }]).currency).toBe("usd");
  });
});

describe("firstYearPlatformCents", () => {
  it("annual price → unit amount", () => {
    expect(firstYearPlatformCents({ items: { data: [{ price: { unit_amount: 1_200_000, recurring: { interval: "year" } } }] } })).toBe(1_200_000);
  });
  it("monthly price → ×12", () => {
    expect(firstYearPlatformCents({ items: { data: [{ price: { unit_amount: 109_900, recurring: { interval: "month" } } }] } })).toBe(1_318_800);
  });
  it("unknown cadence → treats unit as the year (conservative)", () => {
    expect(firstYearPlatformCents({ items: { data: [{ price: { unit_amount: 5000, recurring: null } }] } })).toBe(5000);
  });
  it("missing price → 0 (no cap)", () => {
    expect(firstYearPlatformCents(null)).toBe(0);
    expect(firstYearPlatformCents({ items: { data: [] } })).toBe(0);
  });
});

describe("computeCreditCents", () => {
  it("credits 100% of spend when below the first-year cap", () => {
    expect(computeCreditCents(34_800, 1_318_800)).toBe(34_800); // $348 Brief vs $13,188 Platform/yr
  });
  it("caps at the first-year platform cost", () => {
    expect(computeCreditCents(2_000_000, 1_200_000)).toBe(1_200_000);
  });
  it("zero/invalid spend → 0", () => {
    expect(computeCreditCents(0, 1_200_000)).toBe(0);
    expect(computeCreditCents(-5, 1_200_000)).toBe(0);
    expect(computeCreditCents(NaN, 1_200_000)).toBe(0);
  });
  it("no cap (firstYear 0) → full spend", () => {
    expect(computeCreditCents(34_800, 0)).toBe(34_800);
  });
});

/* ---- orchestration with an injected fake Stripe ---- */

function fakeStripe(over: Record<string, any> = {}) {
  return {
    customers: {
      listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
      createBalanceTransaction: vi.fn().mockResolvedValue({ id: "cbt_1" }),
    },
    invoices: {
      list: vi.fn().mockResolvedValue({ data: [{ amount_paid: 2900, currency: "usd" }, { amount_paid: 2900, currency: "usd" }] }),
    },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({ items: { data: [{ price: { unit_amount: 1_200_000, recurring: { interval: "year" } } }] } }),
    },
    ...over,
  } as any;
}

const BASE = {
  customerId: "cus_1",
  newSubscriptionId: "sub_platform",
  priorBriefSubscriptionIds: ["sub_brief"],
  organizationId: "11111111-1111-1111-1111-111111111111",
  nowMs: 1_750_000_000_000,
};

describe("applyBriefToPlatformCredit", () => {
  beforeEach(() => { process.env[FLAG] = "true"; });

  it("flag off → no-op, no Stripe calls, returns 0", async () => {
    delete process.env[FLAG];
    const stripe = fakeStripe();
    const credited = await applyBriefToPlatformCredit({ ...BASE, stripe });
    expect(credited).toBe(0);
    expect(stripe.customers.listBalanceTransactions).not.toHaveBeenCalled();
  });

  it("happy path: credits 100% of Brief spend as a negative balance txn with the marker", async () => {
    const stripe = fakeStripe();
    const credited = await applyBriefToPlatformCredit({ ...BASE, stripe });
    expect(credited).toBe(5800);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    const [cust, body] = stripe.customers.createBalanceTransaction.mock.calls[0];
    expect(cust).toBe("cus_1");
    expect(body.amount).toBe(-5800); // negative = credit
    expect(body.currency).toBe("usd");
    expect(body.metadata[CREDIT_METADATA_KEY]).toBe(CREDIT_REASON);
    expect(body.metadata.organization_id).toBe(BASE.organizationId);
  });

  it("idempotent: skips when a prior credit marker already exists", async () => {
    const stripe = fakeStripe({
      customers: {
        listBalanceTransactions: vi.fn().mockResolvedValue({ data: [{ metadata: { [CREDIT_METADATA_KEY]: CREDIT_REASON } }] }),
        createBalanceTransaction: vi.fn(),
      },
    });
    const credited = await applyBriefToPlatformCredit({ ...BASE, stripe });
    expect(credited).toBe(0);
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("caps the credit at the first-year platform cost", async () => {
    const stripe = fakeStripe({
      invoices: { list: vi.fn().mockResolvedValue({ data: [{ amount_paid: 9_000_000, currency: "usd" }] }) },
      subscriptions: { retrieve: vi.fn().mockResolvedValue({ items: { data: [{ price: { unit_amount: 1_200_000, recurring: { interval: "year" } } }] } }) },
    });
    const credited = await applyBriefToPlatformCredit({ ...BASE, stripe });
    expect(credited).toBe(1_200_000);
    expect(stripe.customers.createBalanceTransaction.mock.calls[0][1].amount).toBe(-1_200_000);
  });

  it("no prior brief subs → no-op", async () => {
    const stripe = fakeStripe();
    const credited = await applyBriefToPlatformCredit({ ...BASE, priorBriefSubscriptionIds: [], stripe });
    expect(credited).toBe(0);
    expect(stripe.invoices.list).not.toHaveBeenCalled();
  });

  it("no trailing Brief spend → no credit", async () => {
    const stripe = fakeStripe({ invoices: { list: vi.fn().mockResolvedValue({ data: [] }) } });
    const credited = await applyBriefToPlatformCredit({ ...BASE, stripe });
    expect(credited).toBe(0);
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("never throws — a Stripe error returns 0", async () => {
    const stripe = fakeStripe({
      customers: {
        listBalanceTransactions: vi.fn().mockRejectedValue(new Error("stripe down")),
        createBalanceTransaction: vi.fn(),
      },
    });
    const credited = await applyBriefToPlatformCredit({ ...BASE, stripe });
    expect(credited).toBe(0);
  });

  it("excludes the new platform subscription from the brief-spend scan", async () => {
    const stripe = fakeStripe();
    await applyBriefToPlatformCredit({ ...BASE, priorBriefSubscriptionIds: ["sub_platform", "sub_brief"], stripe });
    // sub_platform is the new sub → must be skipped; only sub_brief is queried.
    expect(stripe.invoices.list).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.list.mock.calls[0][0].subscription).toBe("sub_brief");
  });
});
