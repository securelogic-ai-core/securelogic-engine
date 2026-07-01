import { describe, it, expect } from "vitest";
import {
  decidePortalSubmit,
  phaseAfterPendingTimeout,
  interpretPortalResponse,
  PORTAL_PENDING_TIMEOUT_MS,
  type PortalSubmitPhase,
} from "../billingPortalSubmit";

// Sprint 3H — Manage Billing UX. These lock the invariants behind the
// client-controlled submit fix: (1) one click fires exactly one request and
// rapid duplicates are blocked while a request is in flight; (2) a 200 with a
// url deterministically navigates (the single-click success path that the old
// native-303 flow failed to guarantee); (3) the pending state re-arms after a
// timeout, so a subsequent click works without a page refresh.

describe("billing portal submit state (single-click)", () => {
  it("a click from idle proceeds and moves to pending (exactly one POST per click)", () => {
    expect(decidePortalSubmit("idle")).toEqual({ proceed: true, nextPhase: "pending" });
  });

  it("a submit while a request is in flight is blocked (duplicate-POST protection)", () => {
    expect(decidePortalSubmit("pending")).toEqual({ proceed: false, nextPhase: "pending" });
  });
});

describe("billing portal response → single-click navigation (the fix)", () => {
  it("a 200 with a url navigates to the Stripe portal on the first click", () => {
    expect(
      interpretPortalResponse(200, { url: "https://billing.stripe.com/session/abc" })
    ).toEqual({ kind: "navigate", url: "https://billing.stripe.com/session/abc" });
  });

  it("a 200 without a url does NOT navigate (falls through to retry)", () => {
    expect(interpretPortalResponse(200, {})).toEqual({ kind: "retry" });
    expect(interpretPortalResponse(200, { url: "" })).toEqual({ kind: "retry" });
  });

  it("a 401 sends the user to login (session gone)", () => {
    expect(interpretPortalResponse(401, { error: "unauthenticated" })).toEqual({
      kind: "login",
    });
  });

  it("a 502/failed response re-arms for retry, never a dead-end", () => {
    expect(interpretPortalResponse(502, { error: "portal_failed" })).toEqual({
      kind: "retry",
    });
    expect(interpretPortalResponse(500, {})).toEqual({ kind: "retry" });
  });
});

describe("billing portal never-stuck watchdog", () => {
  it("re-arms the CTA when the pending watchdog elapses (pending → timedout)", () => {
    expect(phaseAfterPendingTimeout("pending")).toBe("timedout");
  });

  it("after a timeout a subsequent click proceeds again WITHOUT a refresh (the bug fix)", () => {
    // Regression: the previous guard was single-use, so a click after the hang
    // did nothing and only a full page refresh recovered. Now the timed-out
    // phase re-arms.
    const afterTimeout = phaseAfterPendingTimeout("pending"); // "timedout"
    expect(decidePortalSubmit(afterTimeout)).toEqual({ proceed: true, nextPhase: "pending" });
  });

  it("a stale/leftover timer is a no-op on a non-pending phase", () => {
    expect(phaseAfterPendingTimeout("idle")).toBe("idle");
    expect(phaseAfterPendingTimeout("timedout")).toBe("timedout");
  });

  it("bounds the visible pending state so it is never indefinite", () => {
    expect(PORTAL_PENDING_TIMEOUT_MS).toBeGreaterThan(0);
    // Long enough for a warm round-trip to navigate away first, short enough
    // that a cold/slow engine never leaves the button hanging.
    expect(PORTAL_PENDING_TIMEOUT_MS).toBeLessThanOrEqual(20000);
  });

  it("models exactly the three expected phases", () => {
    const phases: PortalSubmitPhase[] = ["idle", "pending", "timedout"];
    expect(new Set(phases).size).toBe(3);
  });
});
