/**
 * briefCatchup.test.ts — the missed/interrupted-week catch-up: per-org
 * completeness detection + the flag-gated, idempotent recovery entry point.
 *
 * Completeness is derived from PUBLISHED briefs per org against the current
 * weekly window (currentBriefWeekStart — most recent Tuesday 07:00 UTC), not
 * from "any brief generated today": an interrupted Tuesday run leaves early
 * orgs published and tail orgs missing, and the old run-level predicate read
 * that as "already ran" (the 2026-08-11 staging failure). Sends never gate
 * detection — generation is decoupled from email recipients (ADR-0007).
 *
 * Cadence policy (operator-ratified 2026-08-18): catch-up GENERATION may run
 * any weekday within the cadence week (Wednesday+ after a Tuesday outage
 * included); the EMAIL send-day control stays in runScheduler (isBriefSendDay),
 * so out-of-window catch-up never emails.
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

import { findCatchupMissingOrgIds, runBriefCatchupIfMissed } from "../lib/briefCatchup.js";
import { pgElevated } from "../infra/postgres.js";
import { runSchedulerGuarded } from "../lib/schedulerRunner.js";

const TUE_0730 = new Date("2026-07-07T07:30:00Z"); // Tuesday, after 07:00 UTC
const TUE_0630 = new Date("2026-07-07T06:30:00Z"); // Tuesday, before 07:00 UTC
const WED_0900 = new Date("2026-07-08T09:00:00Z"); // Wednesday after the Tuesday window opened
const MON_1000 = new Date("2026-07-13T10:00:00Z"); // following Monday, same cadence week

const THIS_WEEK_START = "2026-07-07T07:00:00.000Z";
const LAST_WEEK_START = "2026-06-30T07:00:00.000Z";

const FLAG = "SECURELOGIC_BRIEF_CATCHUP_ENABLED";

const mockMissingOrgs = (ids: string[]) =>
  vi.mocked(pgElevated.query).mockResolvedValue({ rows: ids.map((id) => ({ id })) } as never);

describe("findCatchupMissingOrgIds (detection query)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the CURRENT weekly window start (Tuesday 07:00 UTC) as the boundary", async () => {
    mockMissingOrgs([]);
    await findCatchupMissingOrgIds(WED_0900);
    expect(vi.mocked(pgElevated.query).mock.calls[0]?.[1]).toEqual([THIS_WEEK_START]);
  });

  it("on Tuesday BEFORE 07:00 UTC the applicable window is still LAST week's (cron not fired yet)", async () => {
    mockMissingOrgs([]);
    await findCatchupMissingOrgIds(TUE_0630);
    expect(vi.mocked(pgElevated.query).mock.calls[0]?.[1]).toEqual([LAST_WEEK_START]);
  });

  it("is per-org, generation-based, and carves out mid-week signups", () => {
    // Contract pinned structurally: completeness must enumerate ORGS against
    // published briefs (never sends), and exclude orgs created inside the
    // window (their first edition is the next Tuesday run).
    mockMissingOrgs([]);
    return findCatchupMissingOrgIds(WED_0900).then(() => {
      const sql = vi.mocked(pgElevated.query).mock.calls[0]?.[0] as string;
      expect(sql).toContain("FROM organizations");
      expect(sql).toContain("status = 'published'");
      expect(sql).toContain("o.created_at < $1");
      expect(sql).not.toContain("intelligence_brief_sends");
    });
  });
});

describe("runBriefCatchupIfMissed (flag-gated, completeness-driven)", () => {
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

  it("recovers an INTERRUPTED run: some orgs published, tail orgs missing → scheduler reruns", async () => {
    // The 2026-08-11 staging failure: 9 of 12 orgs published before a deploy
    // SIGTERM killed the run. Run-level detection ("any brief today") read
    // that as complete; per-org completeness must not.
    process.env[FLAG] = "true";
    mockMissingOrgs(["org-c", "org-d"]);

    const result = await runBriefCatchupIfMissed(TUE_0730);

    expect(result).toEqual({ ran: true, reason: "recovered" });
    expect(runSchedulerGuarded).toHaveBeenCalledTimes(1);
    expect(runSchedulerGuarded).toHaveBeenCalledWith("catchup");
  });

  it("Tuesday outage → WEDNESDAY boot still recovers the missing edition", async () => {
    process.env[FLAG] = "true";
    mockMissingOrgs(["org-tail"]);

    const result = await runBriefCatchupIfMissed(WED_0900);

    expect(result).toEqual({ ran: true, reason: "recovered" });
    expect(runSchedulerGuarded).toHaveBeenCalledWith("catchup");
    // Detection ran against THIS week's window, not last week's.
    expect(vi.mocked(pgElevated.query).mock.calls[0]?.[1]).toEqual([THIS_WEEK_START]);
  });

  it("recovers late in the cadence week (following Monday) until the next window supersedes", async () => {
    process.env[FLAG] = "true";
    mockMissingOrgs(["org-tail"]);

    const result = await runBriefCatchupIfMissed(MON_1000);

    expect(result).toEqual({ ran: true, reason: "recovered" });
    expect(vi.mocked(pgElevated.query).mock.calls[0]?.[1]).toEqual([THIS_WEEK_START]);
  });

  it("does NOT run when every eligible org already has this week's brief", async () => {
    process.env[FLAG] = "true";
    mockMissingOrgs([]);

    const result = await runBriefCatchupIfMissed(WED_0900);

    expect(result).toEqual({ ran: false, reason: "week_complete" });
    expect(runSchedulerGuarded).not.toHaveBeenCalled();
  });

  it("a zero-recipient week (no send rows) does NOT retrigger catch-up once briefs are generated", async () => {
    // The regression this contract prevents: with send-based detection, a week
    // where every org has zero email recipients records no sends, so every
    // boot would re-run the scheduler and generate duplicate briefs.
    process.env[FLAG] = "true";
    mockMissingOrgs([]);

    const result = await runBriefCatchupIfMissed(TUE_0730);

    expect(result.ran).toBe(false);
    expect(runSchedulerGuarded).not.toHaveBeenCalled();
    const sql = vi.mocked(pgElevated.query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("FROM intelligence_briefs");
    expect(sql).not.toContain("intelligence_brief_sends");
  });

  it("fails safe (no throw, no run) if the completeness query errors", async () => {
    process.env[FLAG] = "true";
    vi.mocked(pgElevated.query).mockRejectedValue(new Error("db down") as never);

    const result = await runBriefCatchupIfMissed(TUE_0730);

    expect(result).toEqual({ ran: false, reason: "query_failed" });
    expect(runSchedulerGuarded).not.toHaveBeenCalled();
  });
});
