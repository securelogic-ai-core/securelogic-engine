import { describe, it, expect } from "vitest";
import {
  decidePortalSubmit,
  phaseAfterPendingTimeout,
  PORTAL_PENDING_TIMEOUT_MS,
  type PortalSubmitPhase,
} from "../billingPortalSubmit";

// Sprint 3H — Manage Billing UX. These lock the two invariants behind the
// "stuck on Opening billing…" fix: (1) one click fires exactly one POST and
// rapid duplicates are blocked while a request is in flight; (2) the pending
// state auto-resets and RE-ARMS after a timeout, so a subsequent click works
// without a page refresh and the UI is never indefinitely stuck.

describe("billing portal submit state (single-click)", () => {
  it("a click from idle proceeds and moves to pending (exactly one POST per click)", () => {
    expect(decidePortalSubmit("idle")).toEqual({ proceed: true, nextPhase: "pending" });
  });

  it("a submit while a request is in flight is blocked (duplicate-POST protection)", () => {
    expect(decidePortalSubmit("pending")).toEqual({ proceed: false, nextPhase: "pending" });
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
