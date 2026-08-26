/**
 * /account — the three billing states (SL-BILL-1 PR-H).
 *
 * WHAT THIS FILE PROTECTS: that the control we offer a customer actually works
 * for the state they are in.
 *
 * Under ruling P6 the end of dunning CANCELS the Stripe subscription, and a
 * cancelled subscription cannot be revived by a card update — the Customer
 * Portal has nothing left to update. So "Update Billing" is the right action
 * during grace and a DEAD END after suspension, at the exact moment the
 * customer is trying to give us money. That distinction is invisible to an
 * engine test: it lives entirely in which control renders, so only a render
 * test can hold it.
 *
 * The grace decision itself is NOT computed here. It arrives on the wire as
 * `grace_state`, from the same engine function that enforces entitlement and
 * words the dunning emails — so /account cannot tell a customer something
 * different from what the platform is doing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp, hrefs } from "@/test/harness";
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

const render = () => renderPage(AccountPage, { searchParams: sp({}) });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getAuthMe.mockResolvedValue(anAuthMe({ role: "admin" }));
});

/* ── Healthy ─────────────────────────────────────────────────────────────── */

describe("healthy", () => {
  it("shows no delinquency banner at all", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "premium", billingActive: true }));
    api.getSubscription.mockResolvedValue(aSubscription());

    await render();

    expect(screen.queryByText(/Your access is suspended/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/access continues until/i)).not.toBeInTheDocument();
  });
});

/* ── In grace ────────────────────────────────────────────────────────────── */

describe("in grace — the subscription is live, so the card fix is the action", () => {
  beforeEach(() => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "premium", billingActive: false }));
    api.getSubscription.mockResolvedValue(
      aSubscription({
        status: "past_due",
        payment_failed_at: "2026-08-20T00:00:00.000Z",
        grace_state: "in_grace",
        grace_ends_at: "2026-09-04T00:00:00.000Z",
      })
    );
  });

  it("states the real date access ends", async () => {
    await render();

    expect(screen.getByText(/September 4, 2026/)).toBeInTheDocument();
  });

  it("offers the PORTAL, not checkout — there is a subscription to fix", async () => {
    await render();

    expect(screen.getByRole("button", { name: /Update Payment Method/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resubscribe/i })).not.toBeInTheDocument();
  });

  it("does not tell them they are suspended", async () => {
    await render();

    expect(screen.queryByText(/Your access is suspended/i)).not.toBeInTheDocument();
  });

  it("names no date when the engine sends none, rather than inventing one", async () => {
    api.getSubscription.mockResolvedValue(
      aSubscription({
        status: "past_due",
        payment_failed_at: "2026-08-20T00:00:00.000Z",
        grace_state: "in_grace",
        grace_ends_at: null,
      })
    );

    await render();

    expect(screen.getByText(/keep your access uninterrupted/i)).toBeInTheDocument();
  });
});

/* ── Suspended ───────────────────────────────────────────────────────────── */

describe("suspended — the subscription is gone, so checkout is the action", () => {
  const suspended = (tier: string | null = "platform") => {
    api.getMe.mockResolvedValue(
      aMe({ entitlementLevel: "starter", billingActive: false, stripeSubscriptionTier: tier })
    );
    api.getSubscription.mockResolvedValue(
      aSubscription({
        status: "canceled",
        entitlement_level: "starter",
        payment_failed_at: "2026-08-20T00:00:00.000Z",
        grace_state: "lapsed",
      })
    );
  };

  it("offers CHECKOUT, not the portal — the portal is a dead end for a cancelled subscription", async () => {
    suspended();

    const { container } = await render();

    expect(screen.getByRole("button", { name: /Resubscribe/i })).toBeInTheDocument();
    const forms = Array.from(container.querySelectorAll("form"));
    const resub = forms.find((f) => f.textContent?.match(/Resubscribe/));
    expect(resub?.getAttribute("action")).toBe("/api/billing/checkout");
  });

  it("offers back the tier they HELD, not a cheaper default", async () => {
    // A returning Platform customer must not be quietly offered Brief Pro.
    suspended("platform_annual");

    const { container } = await render();

    const resub = Array.from(container.querySelectorAll("form"))
      .find((f) => f.textContent?.match(/Resubscribe/));
    expect(resub?.querySelector('input[name="tier"]')?.getAttribute("value"))
      .toBe("platform_annual");
  });

  it("falls back to platform when no prior tier is recorded", async () => {
    suspended(null);

    const { container } = await render();

    const resub = Array.from(container.querySelectorAll("form"))
      .find((f) => f.textContent?.match(/Resubscribe/));
    expect(resub?.querySelector('input[name="tier"]')?.getAttribute("value")).toBe("platform");
  });

  it("says the data is still there — the single most reassuring true fact", async () => {
    suspended();

    await render();

    expect(screen.getByText(/Nothing has been deleted/i)).toBeInTheDocument();
  });

  it("tells a non-admin who can fix it instead of showing a control they cannot use", async () => {
    api.getAuthMe.mockResolvedValue(anAuthMe({ role: "member" }));
    suspended();

    await render();

    expect(screen.queryByRole("button", { name: /Resubscribe/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an admin/i)).toBeInTheDocument();
  });
});

/* ── The wire is the authority ───────────────────────────────────────────── */

describe("the page does not re-derive the grace decision", () => {
  it("honours grace_state even when it disagrees with what the page might guess", async () => {
    // payment_failed_at is set and the tier is still premium — a client-side
    // guess would call that "in grace". The engine says lapsed (its flag is
    // off), and the engine wins.
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "premium", billingActive: false }));
    api.getSubscription.mockResolvedValue(
      aSubscription({
        status: "past_due",
        payment_failed_at: "2026-08-20T00:00:00.000Z",
        grace_state: "lapsed",
      })
    );

    await render();

    expect(screen.getByText(/Your access is suspended/i)).toBeInTheDocument();
    expect(screen.queryByText(/access continues until/i)).not.toBeInTheDocument();
  });
});
