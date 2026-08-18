/**
 * briefStalenessMonitor.test.ts — the daily outcome-based sweep: eligible orgs
 * missing the CURRENT WEEKLY EDITION must trip an operator alert (ADR-0007
 * observability).
 *
 * The sweep is completeness-based, not age-based. The former 8-day age
 * threshold could hide a real miss for over a week: an org created days before
 * its first run was excluded by the young-org carve-out, so a missed FIRST
 * edition stayed invisible until the org itself aged past 8 days (staging,
 * 2026-08-11 — an interrupted run left two orgs without the week's brief and
 * only the older one alerted). Detection now uses the SAME predicate the
 * catch-up reconciles on (sqlMissingCurrentBrief against
 * currentBriefWeekStart), so monitoring and recovery cannot disagree.
 *
 * 2026-07-07 is a Tuesday; the window opens 2026-07-07T07:00Z.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: vi.fn() },
  pg: { query: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
  requireTenantContext: vi.fn()
}));

vi.mock("../infra/alerting.js", () => ({
  sendFailureAlert: vi.fn(async () => {})
}));

import {
  findStaleBriefOrgs,
  runBriefStalenessCheck,
  BRIEF_WINDOW_GRACE_HOURS
} from "../lib/briefStalenessMonitor.js";
import { pgElevated } from "../infra/postgres.js";
import { sendFailureAlert } from "../infra/alerting.js";

const WEEK_START = "2026-07-07T07:00:00.000Z";
/** Inside the grace period (window +23 h) — the run may still be in flight. */
const WITHIN_GRACE = new Date("2026-07-08T06:00:00Z");
/** Exactly at the grace boundary (window +24 h) — alertable. */
const AT_GRACE_EDGE = new Date("2026-07-08T07:00:00Z");
/** Comfortably past grace (Wednesday 08:30 UTC sweep, +25.5 h). */
const AFTER_GRACE = new Date("2026-07-08T08:30:00Z");

describe("findStaleBriefOrgs — window-completeness detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);
  });

  it("flags orgs missing the CURRENT edition, using the shared window predicate", async () => {
    await findStaleBriefOrgs(AFTER_GRACE);

    const [sql, params] = vi.mocked(pgElevated.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM organizations");
    expect(sql).toContain("o.status = 'active'");
    expect(sql).toContain("b.status = 'published'");
    // The completeness predicate, not an age threshold.
    expect(sql).toContain("b.generated_at >= $1");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).not.toContain("make_interval");
    // Bound to the weekly window start, not "N days ago".
    expect(params).toEqual([WEEK_START]);
  });

  it("carves out orgs created INSIDE the window (first edition is the next run)", async () => {
    await findStaleBriefOrgs(AFTER_GRACE);

    const [sql] = vi.mocked(pgElevated.query).mock.calls[0] as [string];
    // A window carve-out, not an age carve-out: the bound is the window start,
    // so an org created BEFORE the window is checked on its very first edition.
    expect(sql).toContain("o.created_at < $1");
    expect(sql).not.toContain("o.created_at < NOW()");
  });

  it("stays silent inside the grace period — the run may still be in progress", async () => {
    const rows = await findStaleBriefOrgs(WITHIN_GRACE);

    expect(rows).toEqual([]);
    expect(pgElevated.query).not.toHaveBeenCalled();
  });

  it("alerts from exactly the grace boundary onward (window + 24 h)", async () => {
    await findStaleBriefOrgs(AT_GRACE_EDGE);
    expect(pgElevated.query).toHaveBeenCalledTimes(1);

    // One millisecond earlier is still inside the grace period.
    vi.clearAllMocks();
    await findStaleBriefOrgs(new Date(AT_GRACE_EDGE.getTime() - 1));
    expect(pgElevated.query).not.toHaveBeenCalled();
  });

  it("pins the grace period to 24 hours", () => {
    expect(BRIEF_WINDOW_GRACE_HOURS).toBe(24);
  });
});

describe("runBriefStalenessCheck — alerting behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("alerts on a NEW org that missed its FIRST edition (the case the 8-day rule hid)", async () => {
    // Created before the window opened but only days old: under the former
    // age carve-out this org was invisible for over a week.
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [{ id: "org-new", name: "Fresh Signup Inc", newest_generated_at: null }]
    } as never);

    const summary = await runBriefStalenessCheck(AFTER_GRACE);

    expect(summary.staleOrgs).toHaveLength(1);
    expect(summary.alerted).toBe(true);
    const [source, message] = vi.mocked(sendFailureAlert).mock.calls[0] as [string, string];
    expect(source).toBe("intelligence-brief-staleness");
    expect(message).toContain("Fresh Signup Inc");
    expect(message).toContain("never");
    expect(message).toContain("missing the current weekly Intelligence Brief edition");
    expect(message).toContain(WEEK_START);
  });

  it("alerts on an established org whose edition is missing, naming its newest prior brief", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [
        { id: "org-1", name: "Acme Corp", newest_generated_at: "2026-06-30 07:05:00+00" },
        { id: "org-2", name: "Beta LLC", newest_generated_at: null }
      ]
    } as never);

    const summary = await runBriefStalenessCheck(AFTER_GRACE);

    expect(summary.staleOrgs).toHaveLength(2);
    expect(summary.alerted).toBe(true);
    expect(sendFailureAlert).toHaveBeenCalledTimes(1);
    const [, message] = vi.mocked(sendFailureAlert).mock.calls[0] as [string, string];
    expect(message).toContain("2 active org(s)");
    expect(message).toContain("Acme Corp");
  });

  it("stays silent when every eligible org has the current edition", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);

    const summary = await runBriefStalenessCheck(AFTER_GRACE);

    expect(summary.staleOrgs).toHaveLength(0);
    expect(summary.alerted).toBe(false);
    expect(sendFailureAlert).not.toHaveBeenCalled();
  });

  it("stays silent inside the grace period even with no briefs yet", async () => {
    const summary = await runBriefStalenessCheck(WITHIN_GRACE);

    expect(summary.staleOrgs).toHaveLength(0);
    expect(summary.alerted).toBe(false);
    expect(pgElevated.query).not.toHaveBeenCalled();
    expect(sendFailureAlert).not.toHaveBeenCalled();
  });

  it("fails safe when the query errors — no throw, no alert", async () => {
    vi.mocked(pgElevated.query).mockRejectedValue(new Error("db down") as never);

    const summary = await runBriefStalenessCheck(AFTER_GRACE);

    expect(summary.staleOrgs).toHaveLength(0);
    expect(summary.alerted).toBe(false);
    expect(sendFailureAlert).not.toHaveBeenCalled();
  });

  it("swallows an alert-webhook failure (observability must never break the cron tick)", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [{ id: "org-1", name: "Acme Corp", newest_generated_at: null }]
    } as never);
    vi.mocked(sendFailureAlert).mockRejectedValue(new Error("webhook down") as never);

    const summary = await runBriefStalenessCheck(AFTER_GRACE);

    expect(summary.staleOrgs).toHaveLength(1);
    expect(summary.alerted).toBe(false);
  });

  it("is read-only — it never generates, sends, or schedules anything", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [{ id: "org-1", name: "Acme Corp", newest_generated_at: null }]
    } as never);

    await runBriefStalenessCheck(AFTER_GRACE);

    const statements = vi.mocked(pgElevated.query).mock.calls.map((c) => String(c[0]));
    for (const sql of statements) {
      expect(sql).toMatch(/^\s*SELECT/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    }
  });
});
