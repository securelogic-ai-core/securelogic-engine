/**
 * briefStalenessMonitor.test.ts — the daily outcome-based staleness sweep:
 * active orgs whose newest published brief is missing or older than the weekly
 * cadence must trip an operator alert (ADR-0007 observability).
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
  BRIEF_STALE_AFTER_DAYS
} from "../lib/briefStalenessMonitor.js";
import { pgElevated } from "../infra/postgres.js";
import { sendFailureAlert } from "../infra/alerting.js";

describe("findStaleBriefOrgs — the detection query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks active orgs against their newest PUBLISHED brief, with a new-org grace period", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);

    await findStaleBriefOrgs();

    const [sql, params] = vi.mocked(pgElevated.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM organizations");
    expect(sql).toContain("o.status = 'active'");
    expect(sql).toContain("LEFT JOIN intelligence_briefs");
    expect(sql).toContain("b.status = 'published'");
    // New-org grace: an org younger than the threshold has no brief yet by design.
    expect(sql).toContain("o.created_at < NOW()");
    // Never-briefed orgs (MAX IS NULL) count as stale — empty is not all-clear.
    expect(sql).toContain("IS NULL");
    expect(params).toEqual([BRIEF_STALE_AFTER_DAYS]);
  });

  it("threshold mirrors the app's customer-facing staleness label (8 days)", () => {
    expect(BRIEF_STALE_AFTER_DAYS).toBe(8);
  });
});

describe("runBriefStalenessCheck — alerting behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("alerts the operator webhook when stale orgs exist, naming them", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [
        { id: "org-1", name: "Acme Corp", newest_generated_at: "2026-07-01 07:05:00+00" },
        { id: "org-2", name: "Beta LLC", newest_generated_at: null }
      ]
    } as never);

    const summary = await runBriefStalenessCheck();

    expect(summary.staleOrgs).toHaveLength(2);
    expect(summary.alerted).toBe(true);
    expect(sendFailureAlert).toHaveBeenCalledTimes(1);
    const [source, message] = vi.mocked(sendFailureAlert).mock.calls[0] as [string, string];
    expect(source).toBe("intelligence-brief-staleness");
    expect(message).toContain("2 active org(s)");
    expect(message).toContain("Acme Corp");
    expect(message).toContain("never");
  });

  it("stays silent when every active org has a current brief", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);

    const summary = await runBriefStalenessCheck();

    expect(summary.staleOrgs).toHaveLength(0);
    expect(summary.alerted).toBe(false);
    expect(sendFailureAlert).not.toHaveBeenCalled();
  });

  it("fails safe when the query errors — no throw, no alert", async () => {
    vi.mocked(pgElevated.query).mockRejectedValue(new Error("db down") as never);

    const summary = await runBriefStalenessCheck();

    expect(summary.staleOrgs).toHaveLength(0);
    expect(summary.alerted).toBe(false);
    expect(sendFailureAlert).not.toHaveBeenCalled();
  });

  it("swallows an alert-webhook failure (observability must never break the cron tick)", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [{ id: "org-1", name: "Acme Corp", newest_generated_at: null }]
    } as never);
    vi.mocked(sendFailureAlert).mockRejectedValue(new Error("webhook down") as never);

    const summary = await runBriefStalenessCheck();

    expect(summary.staleOrgs).toHaveLength(1);
    expect(summary.alerted).toBe(false);
  });
});
