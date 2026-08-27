/**
 * controlMatcherAsync.test.ts — LLM control suggestions moved OFF the Brief
 * publication critical path (Candidate A).
 *
 * The matcher used to run inline inside processSignal: one awaited provider
 * call per Critical/High signal per org, strictly sequential. Measured on
 * staging 2026-08-18, that put 87.6% of the slowest org's 3.15-hour Brief run
 * inside those calls — producing `signal_match_suggestions` rows that Brief
 * generation never reads. The work is now a durable job.
 *
 * What these tests pin:
 *   OFF THE PATH   — processSignal makes no provider call; Brief publication
 *                    cannot wait for, or be failed by, suggestion generation.
 *   DURABLE        — the job is enqueued on the SAME transaction that commits
 *                    the signal, so it exists iff the signal was processed; a
 *                    dead worker's job is re-claimed, not stranded.
 *   IDEMPOTENT     — duplicate/re-ingested signals do not stack jobs, and the
 *                    verdict-cache reservation makes a duplicate execution
 *                    free rather than a second provider call.
 *   TENANT-SCOPED  — every read and write stays inside withTenant.
 *   NON-FATAL      — an enqueue failure never propagates to signal processing.
 *   OBSERVABLE     — queued, completed, retried, exhausted and failed all emit.
 *   NOT WIDENED    — provider concurrency is unchanged: one call at a time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type * as MatcherModule from "../lib/llmControlMatcher.js";

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  withTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
  requireTenantContext: vi.fn(() => ({}))
}));
vi.mock("../lib/llmControlMatcher.js", async (importActual) => {
  const actual = await importActual<MatcherModule>();
  return {
    ...actual,
    runControlMatcherWithOutcome: vi.fn(async () => ({
      written: 2,
      outcome: "written" as const,
      retryable: false
    })),
    llmControlMatcherEnabled: vi.fn(() => true),
    shouldRunControlMatcher: vi.fn(() => true)
  };
});

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  enqueueControlMatcherJob,
  parseControlMatcherPayload,
  CONTROL_MATCHER_JOB_TYPE
} from "../lib/controlMatcherQueue.js";
import {
  claimNextJob,
  processClaimedJob,
  runOneTick,
  type JobRow
} from "../workers/controlMatcherWorker.js";
import {
  runControlMatcherWithOutcome,
  shouldRunControlMatcher,
  llmControlMatcherEnabled
} from "../lib/llmControlMatcher.js";

const ORG = "0a000000-0000-4000-8000-000000000001";
const SIGNAL = "0b000000-0000-4000-8000-000000000002";

const signal = {
  id: SIGNAL,
  signal_type: "vulnerability",
  severity: "Critical",
  normalized_summary: "a critical CVE"
};

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "job-1",
  organization_id: ORG,
  job_type: CONTROL_MATCHER_JOB_TYPE,
  status: "processing",
  attempts: 1,
  max_attempts: 5,
  payload: { signal_id: SIGNAL },
  ...over
});

const events = (name: string) =>
  [
    ...vi.mocked(logger.info).mock.calls,
    ...vi.mocked(logger.warn).mock.calls,
    ...vi.mocked(logger.error).mock.calls
  ]
    .map((c) => c[0] as { event?: string })
    .filter((o) => o?.event === name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logger.info).mockImplementation((() => {}) as never);
  vi.mocked(logger.warn).mockImplementation((() => {}) as never);
  vi.mocked(logger.error).mockImplementation((() => {}) as never);
  vi.mocked(shouldRunControlMatcher).mockReturnValue(true);
  vi.mocked(llmControlMatcherEnabled).mockReturnValue(true);
  vi.mocked(runControlMatcherWithOutcome).mockResolvedValue({
    written: 2,
    outcome: "written",
    retryable: false
  });
  vi.mocked(pg.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
  vi.mocked(pgElevated.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

// ---------------------------------------------------------------------------

describe("processSignal is off the provider critical path", () => {
  it("the inline matcher call is gone from cyberSignalProcessingService", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(here, "../lib/cyberSignalProcessingService.ts"), "utf8");

    // No inline provider call anywhere in signal processing...
    expect(src).not.toMatch(/runLlmControlMatcherForSignal/);
    // ...and the enqueue rides the SAME client as the processing transaction,
    // which is what makes "a job exists iff the signal committed" true.
    expect(src).toMatch(/enqueueControlMatcherJob\(\s*client,\s*orgId,/);
  });

  it("the enqueue is committed with the signal, not after it", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(here, "../lib/cyberSignalProcessingService.ts"), "utf8");

    const enqueueIdx = src.indexOf("enqueueControlMatcherJob(client");
    const commitIdx = src.indexOf('await client.query("COMMIT")', enqueueIdx);
    expect(enqueueIdx).toBeGreaterThan(0);
    // A COMMIT follows the enqueue on the same client — post-commit enqueueing
    // would leave signals marked processed with no job and no way to detect it.
    expect(commitIdx).toBeGreaterThan(enqueueIdx);
  });
});

describe("enqueue", () => {
  it("writes a job for an eligible signal and reports it", async () => {
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ id: "job-9" }] } as never);

    const id = await enqueueControlMatcherJob(pg, ORG, signal);

    expect(id).toBe("job-9");
    const sql = vi.mocked(pg.query).mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO jobs");
    expect(vi.mocked(pg.query).mock.calls[0]![1]).toEqual([
      ORG,
      CONTROL_MATCHER_JOB_TYPE,
      JSON.stringify({ signal_id: SIGNAL })
    ]);
    expect(events("control_matcher_enqueued")).toHaveLength(1);
  });

  it("applies the SAME eligibility gate the inline call used — no row, no cost", async () => {
    vi.mocked(shouldRunControlMatcher).mockReturnValue(false);

    const id = await enqueueControlMatcherJob(pg, ORG, { ...signal, severity: "Low" });

    expect(id).toBeNull();
    expect(vi.mocked(pg.query)).not.toHaveBeenCalled(); // zero DB access when ineligible
  });

  it("does not stack a duplicate job for a re-ingested signal", async () => {
    // The NOT EXISTS arm returns no row when an identical job is already queued.
    vi.mocked(pg.query).mockResolvedValue({ rows: [] } as never);

    const id = await enqueueControlMatcherJob(pg, ORG, signal);

    expect(id).toBeNull();
    const sql = vi.mocked(pg.query).mock.calls[0]![0] as string;
    expect(sql).toContain("NOT EXISTS");
    // Dedup targets QUEUED only: a job already mid-flight may have read older
    // state, and the verdict cache makes the extra execution free anyway.
    expect(sql).toContain("j.status = 'queued'");
    expect(sql).not.toContain("'processing'");
  });

  it("an enqueue failure is non-fatal — signal processing is never rolled back", async () => {
    vi.mocked(pg.query).mockRejectedValue(new Error("jobs table gone") as never);

    await expect(enqueueControlMatcherJob(pg, ORG, signal)).resolves.toBeNull();
    expect(events("control_matcher_enqueue_failed")).toHaveLength(1);
  });

  it("rejects a malformed payload rather than guessing", () => {
    expect(parseControlMatcherPayload({ signal_id: SIGNAL })).toEqual({ signal_id: SIGNAL });
    expect(parseControlMatcherPayload({})).toBeNull();
    expect(parseControlMatcherPayload({ signal_id: "" })).toBeNull();
    expect(parseControlMatcherPayload(null)).toBeNull();
  });
});

describe("claim — restart safety", () => {
  it("claims queued work AND re-claims jobs stranded by a dead worker", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [job()] } as never);

    await claimNextJob("worker-1");

    const sql = vi.mocked(pgElevated.query).mock.calls[0]![0] as string;
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("status = 'queued'");
    // This arm is the whole restart-safety story: a job left 'processing' by a
    // killed process becomes claimable again once its lock goes stale.
    expect(sql).toContain("status = 'processing' AND locked_at <");
    expect(sql).toContain("attempts = attempts + 1");
    // Elevated channel — a context-less poller on the tenant channel sees nothing.
    expect(vi.mocked(pg.query)).not.toHaveBeenCalled();
  });
});

describe("execution", () => {
  it("runs the matcher tenant-scoped and marks the job succeeded", async () => {
    vi.mocked(pg.query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("FROM cyber_signals")) {
        return { rows: [{ ...signal }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }) as never);

    await processClaimedJob(job());

    // Signal load AND the terminal update both inside withTenant.
    expect(vi.mocked(withTenant).mock.calls.every((c) => c[0] === ORG)).toBe(true);
    expect(vi.mocked(withTenant).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(vi.mocked(runControlMatcherWithOutcome)).toHaveBeenCalledTimes(1);

    const done = events("control_matcher_job_completed")[0] as Record<string, unknown>;
    expect(done).toMatchObject({ outcome: "written", suggestions_written: 2 });

    const update = vi
      .mocked(pg.query)
      .mock.calls.find((c) => String(c[0]).includes("status = 'succeeded'"));
    expect(update).toBeDefined();
  });

  it("scopes the signal read to the owning org — no cross-tenant read", async () => {
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);

    await processClaimedJob(job());

    const read = vi
      .mocked(pg.query)
      .mock.calls.find((c) => String(c[0]).includes("FROM cyber_signals"))!;
    expect(String(read[0])).toContain("organization_id = $2");
    expect(read[1]).toEqual([SIGNAL, ORG]);
  });

  // -------------------------------------------------------------------------
  // #883 / F-1 — GLOBAL SIGNALS
  //
  // `cyber_signals` is a TENANT_ISOLATION_STANDARD.md §1 shared table: public
  // -source intelligence (CISA KEV, NVD, advisory feeds) lands with
  // `organization_id IS NULL` and is cross-org visible by design. Wave 4 moved
  // the matcher behind a queue whose worker RE-READS the signal row, and wrote
  // that read as a bare `organization_id = $2` — which cannot match a global
  // row. Every global signal therefore read as "not found" and dead-lettered
  // its job non-retryably: 403 jobs / 31 signals on staging, 2026-08-20..25,
  // 100% of them global. `shouldRunControlMatcher` gates on Critical/High, so
  // the signals being lost were exactly the highest-severity ones.
  //
  // These four pin the predicate SHAPE, not just its effect, because the
  // effect is invisible to a mock that returns a row regardless of the WHERE.
  // -------------------------------------------------------------------------
  it("admits a GLOBAL signal (organization_id IS NULL) — the #883 regression", async () => {
    // The mock answers the read the way Postgres would: a row for the canonical
    // predicate, and NO row for the defective org-only one. A revert to
    // `organization_id = $2` therefore fails this test rather than passing it.
    vi.mocked(pg.query).mockImplementation((async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM cyber_signals")) {
        const admitsGlobal = /organization_id\s*=\s*\$2\s+OR\s+organization_id\s+IS\s+NULL/i.test(
          text
        );
        return admitsGlobal ? { rows: [{ ...signal }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    }) as never);

    await processClaimedJob(job());

    expect(vi.mocked(runControlMatcherWithOutcome)).toHaveBeenCalledTimes(1);
    expect(events("control_matcher_job_failed")).toHaveLength(0);
    expect(events("control_matcher_job_completed")).toHaveLength(1);
  });

  it("the signal read is same-org OR global — the canonical §1 predicate", async () => {
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);

    await processClaimedJob(job());

    const read = vi
      .mocked(pg.query)
      .mock.calls.find((c) => String(c[0]).includes("FROM cyber_signals"))!;
    // Exactly the form the four sibling signal-link routes use. Anything
    // narrower drops global signals; anything wider drops tenant scoping.
    expect(String(read[0])).toMatch(
      /organization_id\s*=\s*\$2\s+OR\s+organization_id\s+IS\s+NULL/i
    );
    // Still parameterised by the job's org — global admission must not become
    // "read any org's signal".
    expect(read[1]).toEqual([SIGNAL, ORG]);
  });

  it("still refuses ANOTHER ORG's private signal — global admission is not a wildcard", async () => {
    // Postgres semantics again: the row is org-owned by someone else, so
    // neither disjunct matches and the read is empty.
    vi.mocked(pg.query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("FROM cyber_signals")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    }) as never);

    await processClaimedJob(job());

    expect(vi.mocked(runControlMatcherWithOutcome)).not.toHaveBeenCalled();
    expect(events("control_matcher_job_failed")).toHaveLength(1);
  });

  it("the matcher's own dedup_hash read admits global signals too", async () => {
    // The SECOND half of #883, in llmControlMatcher's phase 1. It was
    // unreachable only because loadSignal failed first, so fixing the worker
    // alone would merely have moved the silence: a global signal would have
    // returned `no_controls` with the job marked SUCCEEDED.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../lib/llmControlMatcher.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    const dedupRead = source.slice(source.indexOf("SELECT dedup_hash FROM cyber_signals"));
    expect(dedupRead.slice(0, 200)).toMatch(
      /organization_id\s*=\s*\$2\s+OR\s+organization_id\s+IS\s+NULL/i
    );
  });

  it("a retryable outcome re-queues with backoff instead of succeeding silently", async () => {
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);
    vi.mocked(runControlMatcherWithOutcome).mockResolvedValue({
      written: 0,
      outcome: "provider_failed",
      retryable: true
    });

    await processClaimedJob(job({ attempts: 1 }));

    expect(events("control_matcher_job_retry_scheduled")).toHaveLength(1);
    const update = vi
      .mocked(pg.query)
      .mock.calls.find((c) => String(c[0]).includes("next_attempt_at"))!;
    expect(update[1]![1]).toBe("queued");
    expect(update[1]![3]).toBeInstanceOf(Date); // backoff, not immediate
  });

  it("exhausting the retry budget dead-letters LOUDLY rather than going quiet", async () => {
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);
    vi.mocked(runControlMatcherWithOutcome).mockResolvedValue({
      written: 0,
      outcome: "provider_failed",
      retryable: true
    });

    await processClaimedJob(job({ attempts: 5, max_attempts: 5 }));

    expect(events("control_matcher_job_exhausted")).toHaveLength(1);
    const update = vi
      .mocked(pg.query)
      .mock.calls.find((c) => String(c[0]).includes("next_attempt_at"))!;
    expect(update[1]![1]).toBe("dead_lettered");
  });

  it("a dead-lettered verdict is terminal success, not an endless retry", async () => {
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);
    vi.mocked(runControlMatcherWithOutcome).mockResolvedValue({
      written: 0,
      outcome: "exhausted",
      retryable: false
    });

    await processClaimedJob(job());

    expect(events("control_matcher_job_retry_scheduled")).toHaveLength(0);
    expect(events("control_matcher_job_completed")).toHaveLength(1);
  });

  it("a vanished signal fails permanently — no attempt could ever succeed", async () => {
    vi.mocked(pg.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await processClaimedJob(job());

    expect(events("control_matcher_job_failed")).toHaveLength(1);
    expect(vi.mocked(runControlMatcherWithOutcome)).not.toHaveBeenCalled();
  });

  it("a malformed payload fails permanently without touching the matcher", async () => {
    await processClaimedJob(job({ payload: { nope: true } }));

    expect(vi.mocked(runControlMatcherWithOutcome)).not.toHaveBeenCalled();
    expect(events("control_matcher_job_failed")).toHaveLength(1);
  });

  it("processClaimedJob never throws — every outcome lands on the row", async () => {
    vi.mocked(pg.query).mockRejectedValue(new Error("db gone") as never);
    await expect(processClaimedJob(job())).resolves.toBeUndefined();
  });
});

describe("tick", () => {
  it("drains the queue and stops when it is empty", async () => {
    const rows = [job({ id: "j1" }), job({ id: "j2" })];
    let n = 0;
    vi.mocked(pgElevated.query).mockImplementation((async () => ({
      rows: n < rows.length ? [rows[n++]] : []
    })) as never);
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);

    expect(await runOneTick()).toBe(2);
  });

  it("claims nothing while the existing matcher flag is off — one flag drains both ends", async () => {
    vi.mocked(llmControlMatcherEnabled).mockReturnValue(false);

    expect(await runOneTick()).toBe(0);
    expect(vi.mocked(pgElevated.query)).not.toHaveBeenCalled();
  });

  it("provider concurrency is NOT widened — one job in flight at a time", async () => {
    let live = 0;
    let peak = 0;
    const rows = [job({ id: "j1" }), job({ id: "j2" }), job({ id: "j3" })];
    let n = 0;
    vi.mocked(pgElevated.query).mockImplementation((async () => ({
      rows: n < rows.length ? [rows[n++]] : []
    })) as never);
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);
    vi.mocked(runControlMatcherWithOutcome).mockImplementation(async () => {
      live++;
      if (live > peak) peak = live;
      await new Promise<void>((r) => setImmediate(r));
      live--;
      return { written: 1, outcome: "written", retryable: false };
    });

    await runOneTick();

    // The package moves latency off the critical path; it must not hide it
    // behind a wider fan-out at the provider.
    expect(peak).toBe(1);
  });

  it("stops claiming when the shutdown guard says so", async () => {
    vi.mocked(pgElevated.query).mockResolvedValue({ rows: [job()] } as never);
    vi.mocked(pg.query).mockResolvedValue({ rows: [{ ...signal }], rowCount: 1 } as never);

    expect(await runOneTick({ shouldContinue: () => false })).toBe(0);
  });
});
