/**
 * graceWindow.test.ts — the grace decision, at its boundaries (SL-BILL-1).
 *
 * This function is the reason PR-F can be a small in-process worker instead of
 * dedicated infrastructure: because grace is DERIVED here on every request
 * rather than materialised by a job, no missed, late or duplicated sweep can
 * leave a customer wrongly entitled. Everything downstream — enforcement, the
 * Day 7/14 notifications, the Day 15 backstop, and the wording of the dunning
 * emails — is this one function's answer.
 *
 * So the boundaries matter more than the happy path: N−1 / N / N+1 days is
 * where "access ends on DATE" is either honoured or broken.
 */
import { describe, it, expect } from "vitest";

import {
  graceState,
  graceEndsAt,
  graceEnabled,
  graceDays,
  DEFAULT_GRACE_DAYS,
} from "../lib/graceWindow.js";

const ON = { SECURELOGIC_BILLING_GRACE_ENABLED: "true" } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

const T = new Date("2026-08-01T00:00:00.000Z");
const plusDays = (d: number) => new Date(T.getTime() + d * 86_400_000);

describe("healthy", () => {
  it("no payment failure is healthy, flag on or off", () => {
    expect(graceState({ paymentFailedAt: null }, T, ON)).toBe("healthy");
    expect(graceState({ paymentFailedAt: null }, T, OFF)).toBe("healthy");
    expect(graceState({ paymentFailedAt: undefined }, T, ON)).toBe("healthy");
  });

  it("healthy is decided BEFORE the flag, so a paying org is never 'lapsed'", () => {
    expect(graceState({ paymentFailedAt: null, subscriptionStatus: "active" }, T, OFF))
      .toBe("healthy");
  });
});

describe("the flag is the deployment gate", () => {
  it("with grace off, any open failure is lapsed — today's zero-grace behaviour", () => {
    expect(graceState({ paymentFailedAt: T }, T, OFF)).toBe("lapsed");
  });

  it("with grace on, an open failure inside the window is in_grace", () => {
    expect(graceState({ paymentFailedAt: T }, T, ON)).toBe("in_grace");
  });

  it("graceEnabled is strict — only the exact string 'true' turns it on", () => {
    expect(graceEnabled({ SECURELOGIC_BILLING_GRACE_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(graceEnabled({ SECURELOGIC_BILLING_GRACE_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(graceEnabled({ SECURELOGIC_BILLING_GRACE_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(graceEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("the window boundary", () => {
  const env = { ...ON, SECURELOGIC_BILLING_GRACE_DAYS: "15" } as NodeJS.ProcessEnv;

  it("day 14 — still in grace", () => {
    expect(graceState({ paymentFailedAt: T }, plusDays(14), env)).toBe("in_grace");
  });

  it("one second before day 15 — still in grace", () => {
    const justBefore = new Date(plusDays(15).getTime() - 1000);
    expect(graceState({ paymentFailedAt: T }, justBefore, env)).toBe("in_grace");
  });

  it("exactly day 15 — lapsed (the window is exclusive at its end)", () => {
    expect(graceState({ paymentFailedAt: T }, plusDays(15), env)).toBe("lapsed");
  });

  it("day 16 — lapsed", () => {
    expect(graceState({ paymentFailedAt: T }, plusDays(16), env)).toBe("lapsed");
  });

  it("graceEndsAt is exactly start + N days", () => {
    expect(graceEndsAt({ paymentFailedAt: T }, env)?.toISOString())
      .toBe(plusDays(15).toISOString());
  });
});

describe("terminal Stripe status beats the clock", () => {
  for (const status of ["canceled", "unpaid", "incomplete_expired"]) {
    it(`${status} is lapsed even on day 1`, () => {
      expect(graceState({ paymentFailedAt: T, subscriptionStatus: status }, plusDays(1), ON))
        .toBe("lapsed");
    });
  }

  it("past_due is NOT terminal — it is the state grace exists for", () => {
    expect(graceState({ paymentFailedAt: T, subscriptionStatus: "past_due" }, plusDays(1), ON))
      .toBe("in_grace");
  });
});

describe("configuration robustness", () => {
  it("defaults to 15 days when unset", () => {
    expect(graceDays({} as NodeJS.ProcessEnv)).toBe(DEFAULT_GRACE_DAYS);
  });

  it("a garbage or non-positive value falls back rather than producing a zero-day window", () => {
    // A zero-day window would silently mean "no grace" while the flag claims
    // otherwise — the worst of both configurations.
    expect(graceDays({ SECURELOGIC_BILLING_GRACE_DAYS: "abc" } as NodeJS.ProcessEnv)).toBe(15);
    expect(graceDays({ SECURELOGIC_BILLING_GRACE_DAYS: "0" } as NodeJS.ProcessEnv)).toBe(15);
    expect(graceDays({ SECURELOGIC_BILLING_GRACE_DAYS: "-5" } as NodeJS.ProcessEnv)).toBe(15);
  });

  it("honours a custom window so it can track the Stripe Dashboard setting", () => {
    // The retry window lives in Stripe's Dashboard and can change without a
    // deploy; grace has to be able to follow it.
    const env = { ...ON, SECURELOGIC_BILLING_GRACE_DAYS: "8" } as NodeJS.ProcessEnv;
    expect(graceState({ paymentFailedAt: T }, plusDays(7), env)).toBe("in_grace");
    expect(graceState({ paymentFailedAt: T }, plusDays(8), env)).toBe("lapsed");
  });

  it("an unparseable timestamp is treated as healthy, not as an expired window", () => {
    expect(graceState({ paymentFailedAt: "not-a-date" }, T, ON)).toBe("healthy");
  });

  it("accepts an ISO string as well as a Date, since the driver returns either", () => {
    expect(graceState({ paymentFailedAt: T.toISOString() }, plusDays(1), ON)).toBe("in_grace");
  });
});
