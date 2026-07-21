/**
 * briefCatchup.test.ts — the Tuesday missed-week catch-up: pure send-decision
 * predicate + the flag-gated, idempotent recovery entry point.
 *
 * 2026-07-07 is a Tuesday (the weekly send day); all fixtures anchor to it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: vi.fn() },
  pg: { query: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
  requireTenantContext: vi.fn()
}));

vi.mock("../lib/schedulerRunner.js", () => ({
  runSchedulerGuarded: vi.fn(async () => {}),
  startScheduler: vi.fn()
}));

import { shouldRunCatchup, runBriefCatchupIfMissed } from "../lib/briefCatchup.js";
import { pgElevated } from "../infra/postgres.js";
import { runSchedulerGuarded } from "../lib/schedulerRunner.js";

const TUE_0730 = new Date("2026-07-07T07:30:00Z"); // Tuesday, after 07:00 UTC
const TUE_0630 = new Date("2026-07-07T06:30:00Z"); // Tuesday, before 07:00 UTC
const MON_1000 = new Date("2026-07-06T10:00:00Z"); // Monday — not a send day
const SENT_TODAY = new Date("2026-07-07T07:05:00Z");
const SENT_LAST_WEEK = new Date("2026-06-30T07:05:00Z"); // previous Tuesday

const FLAG = "SECURELOGIC_BRIEF_CATCHUP_ENABLED";

describe("shouldRunCatchup (pure)", () => {
  it("runs on Tuesday after 07:00 UTC when nothing has ever been sent", () => {
    expect(shouldRunCatchup(TUE_0730, null)).toBe(true);
  });

  it("runs on Tuesday after 07:00 UTC when the last send was a prior week", () => {
    expect(shouldRunCatchup(TUE_0730, SENT_LAST_WEEK)).toBe(true);
  });

  it("does NOT run if a brief was already sent today (cron already delivered)", () => {
    expect(shouldRunCatchup(TUE_0730, SENT_TODAY)).toBe(false);
  });

  it("does NOT run before 07:00 UTC (cron fire time has not passed)", () => {
    expect(shouldRunCatchup(TUE_0630, null)).toBe(false);
  });

  it("does NOT run on a non-Tuesday (preserves the weekly-Tuesday cadence)", () => {
    expect(shouldRunCatchup(MON_1000, null)).toBe(false);
  });
});

describe("runBriefCatchupIfMissed (flag-gated, idempotent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[FLAG];
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("is a no-op with zero DB access when the flag is off (DARK default)", async () => {
    const result = await runBriefCatchupIfMissed(TUE_0730);
    expect(result).toEqual({ ran: false, reason: "disabled" });
    expect(pgElevated.query).not.toHaveBeenCalled();
    expect(runSchedulerGuarded).not.toHaveBeenCalled();
  });

  it("short-circuits outside the Tuesday post-07:00 window without a DB read", async () => {
    process.env[FLAG] = "true";
    const result = await runBriefCatchupIfMissed(MON_1000);
    expect(result).toEqual({ ran: false, reason: "outside_window" });
    expect(pgElevated.query).not.toHaveBeenCalled();
    expect(runSchedulerGuarded).not.toHaveBeenCalled();
  });

  it("recovers the missed send when enabled and nothing was sent this week", async () => {
    process.env[FLAG] = "true";
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [{ last_sent: null }] } as never);

    const result = await runBriefCatchupIfMissed(TUE_0730);

    expect(result).toEqual({ ran: true, reason: "recovered" });
    expect(runSchedulerGuarded).toHaveBeenCalledTimes(1);
    expect(runSchedulerGuarded).toHaveBeenCalledWith("catchup");
  });

  it("does not run the scheduler if a brief was already sent today", async () => {
    process.env[FLAG] = "true";
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [{ last_sent: SENT_TODAY }] } as never);

    const result = await runBriefCatchupIfMissed(TUE_0730);

    expect(result).toEqual({ ran: false, reason: "already_sent_this_week" });
    expect(runSchedulerGuarded).not.toHaveBeenCalled();
  });

  it("fails safe (no throw, no run) if the last-send query errors", async () => {
    process.env[FLAG] = "true";
    vi.mocked(pgElevated.query).mockRejectedValue(new Error("db down") as never);

    const result = await runBriefCatchupIfMissed(TUE_0730);

    expect(result).toEqual({ ran: false, reason: "query_failed" });
    expect(runSchedulerGuarded).not.toHaveBeenCalled();
  });
});
