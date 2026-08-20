/**
 * /account — the dunning banner render contract (SL-BILL-1, defect D1).
 *
 * WHAT THIS FILE PROTECTS: the only in-product signal a delinquent customer
 * gets. When a card fails, Stripe sends `invoice.payment_failed` (which stamps
 * `organizations.payment_failed_at`) and then `customer.subscription.updated`
 * with `status: past_due`, which the webhook maps to
 * `entitlement_level = 'starter'`. The customer then 403s across the gated
 * route surface.
 *
 * The banner condition used to be:
 *
 *   me.billingActive === false && me.entitlementLevel !== "starter"
 *
 * — which the `past_due` downgrade makes unsatisfiable. The banner was
 * reachable only in the gap between the two webhooks (seconds, or never if
 * they arrive in the other order), so the customer saw 403s and nothing else.
 *
 * The contract pinned here: delinquency is keyed on the `payment_failed_at`
 * stamp from GET /api/billing/subscription — the one field that survives the
 * downgrade — and the recovery control (Stripe portal, deliberately NOT
 * entitlement-gated on the engine) is offered with it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
import { aMe, anAuthMe, aSubscription } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getAuthMe: vi.fn(),
  getSubscription: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import AccountPage from "../page";

const BANNER = /Your last payment could not be processed/i;

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getAuthMe.mockResolvedValue(anAuthMe({ role: "admin" }));
});

describe("D1 — the dunning banner survives the past_due downgrade", () => {
  it("renders once payment failed AND the org has been downgraded to starter", async () => {
    // The state a real delinquent customer is in: entitlement withdrawn,
    // billingActive false, 403s everywhere. This is the case the old
    // `entitlementLevel !== "starter"` conjunct made invisible.
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter", billingActive: false }));
    api.getSubscription.mockResolvedValue(
      aSubscription({
        status: "past_due",
        entitlement_level: "starter",
        payment_failed_at: "2026-08-20T00:00:00.000Z",
      })
    );

    await renderPage(AccountPage, { searchParams: sp({}) });

    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it("still renders in the pre-downgrade window (payment failed, tier not yet withdrawn)", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "premium", billingActive: false }));
    api.getSubscription.mockResolvedValue(
      aSubscription({ payment_failed_at: "2026-08-20T00:00:00.000Z" })
    );

    await renderPage(AccountPage, { searchParams: sp({}) });

    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it("offers the admin the billing-portal recovery control alongside it", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter", billingActive: false }));
    api.getSubscription.mockResolvedValue(
      aSubscription({
        status: "past_due",
        entitlement_level: "starter",
        payment_failed_at: "2026-08-20T00:00:00.000Z",
      })
    );

    await renderPage(AccountPage, { searchParams: sp({}) });

    expect(screen.getByRole("button", { name: /Update Billing/i })).toBeInTheDocument();
  });

  it("does not render for a healthy paying org", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "premium", billingActive: true }));
    api.getSubscription.mockResolvedValue(aSubscription());

    await renderPage(AccountPage, { searchParams: sp({}) });

    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it("does not render for a free org that never paid", async () => {
    // billingActive is false for every starter org. Keying the banner off that
    // alone would tell everyone on the free tier their payment failed.
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter", billingActive: false }));
    api.getSubscription.mockResolvedValue(
      aSubscription({
        tier: "free",
        entitlement_level: "starter",
        status: "none",
        stripe_customer_id: null,
        current_period_end: null,
        subscription_tier: null,
        amount: null,
        currency: null,
        interval: null,
      })
    );

    await renderPage(AccountPage, { searchParams: sp({}) });

    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });
});
