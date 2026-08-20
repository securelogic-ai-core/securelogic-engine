/**
 * briefCrashRecovery.test.ts — the two silent-loss modes of an interrupted
 * weekly Brief run, and the sweepers that recover them.
 *
 * 1. Signals COMMITTED but never PROCESSED. `ingestSignalsForOrg` commits rows
 *    first and processes them afterward; a crash in between strands them at
 *    processed = FALSE, and the next run's ON CONFLICT DO NOTHING guarantees
 *    they are never re-queued. Nothing errors — the signals simply never
 *    become findings.
 * 2. Briefs stranded in 'generating'. Phase 2 runs outside a transaction; a
 *    crash there leaves a row no code path ever transitions, because both the
 *    idempotency skip set and the staleness sweep only recognize 'published'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: vi.fn() },
  pg: { query: vi.fn() },
  withTenant: (_o: string, fn: () => Promise<unknown>) => fn(),
  requireTenantContext: vi.fn()
}));
vi.mock("../lib/cyberSignalProcessingService.js", () => ({
  processSignal: vi.fn(async () => ({}))
}));

import {
  runUnprocessedSignalSweep,
  signalSweeperDisabled
} from "../workers/unprocessedSignalSweeper.js";
import { runOrphanBriefReap, briefReaperDisabled } from "../workers/orphanBriefReaper.js";
import { pgElevated } from "../infra/postgres.js";
import { processSignal } from "../lib/cyberSignalProcessingService.js";

const SWEEPER_FLAG = "SECURELOGIC_SIGNAL_SWEEPER_DISABLED";
const REAPER_FLAG = "SECURELOGIC_BRIEF_REAPER_DISABLED";

const signalRow = (id: string, organization_id = "org-1") => ({
  id,
  organization_id,
  source: "nvd",
  signal_type: "cve",
  severity: "High",
  normalized_summary: "summary",
  affected_vendor: null,
  affected_cve: "CVE-2026-0001"
});

describe("unprocessed-signal sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[SWEEPER_FLAG];
  });
  afterEach(() => {
    delete process.env[SWEEPER_FLAG];
  });

  it("recovers committed-but-unprocessed signals — the interrupted-run orphans", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [signalRow("sig-1"), signalRow("sig-2")],
      rowCount: 2
    } as never);

    const result = await runUnprocessedSignalSweep();

    expect(result).toEqual({ candidates: 2, processed: 2, failed: 0 });
    expect(processSignal).toHaveBeenCalledTimes(2);
    expect(vi.mocked(processSignal).mock.calls[0]?.[0]).toMatchObject({ id: "sig-1" });
  });

  it("EXCLUDES global (NULL-org) signals — they are never marked processed, so they would resweep forever", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await runUnprocessedSignalSweep();

    const sql = vi.mocked(pgElevated.query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("organization_id IS NOT NULL");
    expect(sql).toContain("processed = FALSE");
  });

  it("leaves recently ingested signals to the live run (grace window)", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await runUnprocessedSignalSweep();

    const [sql, params] = vi.mocked(pgElevated.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ingestion_timestamp < NOW() - make_interval(mins =>");
    expect(params?.[0]).toBeGreaterThan(0);
  });

  it("one signal's failure does not stop the batch; the row stays unprocessed for retry", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [signalRow("sig-1"), signalRow("sig-bad"), signalRow("sig-3")],
      rowCount: 3
    } as never);
    vi.mocked(processSignal).mockImplementation(async (s: { id: string }) => {
      if (s.id === "sig-bad") throw new Error("matcher exploded");
      return {} as never;
    });

    const result = await runUnprocessedSignalSweep();

    expect(result).toEqual({ candidates: 3, processed: 2, failed: 1 });
    expect(processSignal).toHaveBeenCalledTimes(3);
  });

  it("is inert with zero DB access when the ops brake is set", async () => {
    process.env[SWEEPER_FLAG] = "true";
    expect(signalSweeperDisabled()).toBe(true);

    const result = await runUnprocessedSignalSweep();

    expect(result).toEqual({ candidates: 0, processed: 0, failed: 0 });
    expect(pgElevated.query).not.toHaveBeenCalled();
    expect(processSignal).not.toHaveBeenCalled();
  });
});

describe("orphan-brief reaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[REAPER_FLAG];
  });
  afterEach(() => {
    delete process.env[REAPER_FLAG];
  });

  it("marks long-stranded 'generating' briefs as failed", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({
      rows: [
        { id: "brief-1", organization_id: "org-1" },
        { id: "brief-2", organization_id: "org-2" }
      ],
      rowCount: 2
    } as never);

    const result = await runOrphanBriefReap();

    expect(result.reaped).toBe(2);
    expect(result.brief_ids).toEqual(["brief-1", "brief-2"]);
    const [sql, params] = vi.mocked(pgElevated.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("SET status = 'failed'");
    expect(sql).toContain("status = 'generating'");
    expect(params?.[0]).toBeGreaterThanOrEqual(1); // hours threshold
  });

  it("only touches rows older than the threshold — a live generation is never failed", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const result = await runOrphanBriefReap();

    expect(result.reaped).toBe(0);
    const sql = vi.mocked(pgElevated.query).mock.calls[0]?.[0] as string;
    expect(sql).toContain("updated_at < NOW() - make_interval(hours =>");
  });

  it("never deletes — the failed row is the evidence a run was interrupted", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await runOrphanBriefReap();

    const sql = vi.mocked(pgElevated.query).mock.calls[0]?.[0] as string;
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).toMatch(/^\s*UPDATE/);
  });

  it("is inert with zero DB access when the ops brake is set", async () => {
    process.env[REAPER_FLAG] = "true";
    expect(briefReaperDisabled()).toBe(true);

    const result = await runOrphanBriefReap();

    expect(result).toEqual({ reaped: 0, brief_ids: [] });
    expect(pgElevated.query).not.toHaveBeenCalled();
  });
});
