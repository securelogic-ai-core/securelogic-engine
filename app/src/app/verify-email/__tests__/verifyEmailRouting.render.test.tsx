/**
 * /verify-email — where a customer lands the moment their email is verified.
 *
 * This is the last step of self-serve onboarding and the first navigation the
 * product performs on the customer's behalf, so getting it wrong is expensive
 * in a way that is hard to notice: nothing errors, the customer simply never
 * sees the setup checklist they paid for.
 *
 * The defect these cases lock out: the platform check read
 * `entitlementLevel === "premium"` while the platform-entitled family is
 * `premium | platform | team`. A `platform` or `team` org was routed to
 * /dashboard instead of /getting-started. It stayed invisible because Stripe
 * writes only `starter | professional | premium` — the other two values arrive
 * via seeds, manual provisioning and legacy rows — so no Stripe-driven
 * walkthrough could reach the broken branch.
 *
 * Routing precedence is asserted as a whole, not just the fixed line: a
 * pending paid plan still wins over everything, and a completed onboarding
 * still sends the customer to /dashboard even when fully entitled. A fix that
 * widened entitlement but broke either of those would be a worse regression
 * than the bug.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import {
  setClientSearchParams,
  resetClientSearchParams,
  clientRouter,
  pushedTo,
} from "@/test/harness";

import VerifyEmailPage from "../page";

const TOKEN = "verify-token-123";

/** What POST /api/auth-verify-email answers for this render. */
function mockVerify(body: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Land on the page with a verification token, as the emailed link does, and
 * wait for the auto-verify effect to finish routing.
 */
async function verifyAndWait(body: Record<string, unknown>) {
  mockVerify({ ok: true, ...body });
  setClientSearchParams(`token=${TOKEN}`);
  render(<VerifyEmailPage />);
  await waitFor(() => {
    expect(clientRouter.push).toHaveBeenCalled();
  });
}

beforeEach(() => {
  setClientSearchParams("");
});

afterEach(() => {
  resetClientSearchParams();
  vi.unstubAllGlobals();
  // postToCheckout appends its form to document.body, which testing-library's
  // cleanup() does not touch (it only unmounts the render container). Left
  // behind, the previous test's form is the one the next test finds, and every
  // checkout case after the first would assert against a stale tier.
  document.body
    .querySelectorAll('form[action="/api/billing/checkout"]')
    .forEach((f) => f.remove());
});

describe("post-verification routing — the platform-entitled family", () => {
  it.each(["premium", "platform", "team"])(
    "sends a verified '%s' org with incomplete onboarding to /getting-started",
    async (entitlementLevel) => {
      await verifyAndWait({ entitlementLevel, onboardingCompleted: false });
      expect(pushedTo()).toBe("/getting-started");
    }
  );

  it.each(["starter", "professional", "standard", "enterprise"])(
    "sends a verified '%s' org to /dashboard — it is not entitled to the checklist",
    async (entitlementLevel) => {
      await verifyAndWait({ entitlementLevel, onboardingCompleted: false });
      expect(pushedTo()).toBe("/dashboard");
    }
  );

  it("a missing entitlement level routes to /dashboard, not the checklist", async () => {
    await verifyAndWait({ onboardingCompleted: false });
    expect(pushedTo()).toBe("/dashboard");
  });

  it("agrees with the destination's own gate (no bounce-back loop)", async () => {
    // /getting-started enforces the SAME predicate. If this routing were the
    // wider of the two, the customer would be pushed to a page that
    // immediately redirects them back — a visible flicker ending at
    // /dashboard, having been promised setup. Same predicate, same answer.
    await verifyAndWait({ entitlementLevel: "team", onboardingCompleted: false });
    expect(pushedTo()).toBe("/getting-started");
  });
});

describe("post-verification routing — precedence is unchanged", () => {
  it.each(["professional", "teams", "platform", "platform_annual"])(
    "a pending '%s' checkout wins over any entitlement routing",
    async (pendingPlan) => {
      mockVerify({ ok: true, pendingPlan, entitlementLevel: "platform", onboardingCompleted: false });
      setClientSearchParams(`token=${TOKEN}`);
      render(<VerifyEmailPage />);

      // The checkout path builds a real form on document.body and submits it
      // (a top-level navigation fetch() cannot perform), so the router must
      // stay untouched — the customer must not be raced to /getting-started
      // while Stripe is being handed the session. Note the entitlement here is
      // `platform`, one of the two values this PR newly admits: precedence has
      // to hold precisely where the routing changed.
      const form = await waitFor(() => {
        const f = document.body.querySelector<HTMLFormElement>(
          'form[action="/api/billing/checkout"]'
        );
        expect(f).toBeTruthy();
        return f!;
      });
      expect(form.querySelector<HTMLInputElement>('input[name="tier"]')?.value).toBe(pendingPlan);
      expect(clientRouter.push).not.toHaveBeenCalled();
    }
  );

  it("completed onboarding sends even a fully entitled org to /dashboard", async () => {
    await verifyAndWait({ entitlementLevel: "premium", onboardingCompleted: true });
    expect(pushedTo()).toBe("/dashboard");
  });

  it.each(["platform", "team"])(
    "completed onboarding still wins for '%s' (the newly-admitted values)",
    async (entitlementLevel) => {
      await verifyAndWait({ entitlementLevel, onboardingCompleted: true });
      expect(pushedTo()).toBe("/dashboard");
    }
  );

  it("a failed verification routes nowhere and shows the error instead", async () => {
    mockVerify({ error: "token_expired" }, false);
    setClientSearchParams(`token=${TOKEN}`);
    const { findByText } = render(<VerifyEmailPage />);

    expect(await findByText(/this verification link has expired/i)).toBeTruthy();
    expect(clientRouter.push).not.toHaveBeenCalled();
  });

  it("no token means no verification attempt and no routing", async () => {
    const fetchMock = mockVerify({ ok: true });
    setClientSearchParams("");
    render(<VerifyEmailPage />);

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clientRouter.push).not.toHaveBeenCalled();
  });
});
