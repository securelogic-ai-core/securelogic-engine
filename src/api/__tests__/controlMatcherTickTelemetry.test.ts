/**
 * controlMatcherTickTelemetry.test.ts — the matcher worker reports its own cost
 * and cache behaviour, at the only boundary that is truthful.
 *
 * BACKGROUND
 * ----------
 * Wave 4 moved control matching into `securelogic-intelligence-worker`. The
 * Brief scheduler's run accumulator lives in the engine process, so matcher
 * spend and verdict-cache activity stopped being captured by anything that
 * aggregates: the only surviving trace was one `llm_call_usage` /
 * `llm_verdict_cache_lookup` line per event, in a different service's logs,
 * with no totals. The #826 gate could not produce a cost figure at all.
 *
 * WHY THE TICK, AND NOT THE BRIEF RUN
 * -----------------------------------
 * `runOneTick` drains the queue to empty, never overlaps itself, and runs in
 * one process — a real, bounded unit of work. A Brief run is NOT available as a
 * boundary: ticks fire every minute regardless of the scheduler, and a signal
 * enqueued by a Brief run is routinely matched long after that run finished.
 * These tests pin that the event measures the tick and does not claim a run.
 *
 * WHAT THIS SUITE PINS
 *   AGGREGATES        — totals across the jobs a tick actually drained.
 *   PURPOSE-FILTERED  — non-matcher provider calls sharing the process are
 *                       EXCLUDED; the worker also runs the hourly ingest cycle.
 *   NO FALSE ZERO     — a tick that measured nothing reports no numbers.
 *   SURVIVES A THROW  — spend already incurred is still reported.
 *   NO TENANT DATA    — the rollup is operational telemetry, not a second
 *                       tenant surface.
 *   NON-LOAD-BEARING  — telemetry can never fail the drain.
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
      written: 1,
      outcome: "written" as const,
      retryable: false
    })),
    llmControlMatcherEnabled: vi.fn(() => true),
    shouldRunControlMatcher: vi.fn(() => true)
  };
});

import { pg, pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { runOneTick } from "../workers/controlMatcherWorker.js";
import {
  runControlMatcherWithOutcome,
  LLM_CONTROL_MATCHER_PURPOSE
} from "../lib/llmControlMatcher.js";
import {
  recordLlmUsage,
  resetLlmRunAccumulationForTest,
  withLlmCallContext
} from "../lib/llm/llmTelemetry.js";
import {
  recordVerdictCacheEvent,
  resetVerdictCacheAccumulationForTest
} from "../lib/llm/verdictCacheMetrics.js";
import { isNotMeasuredInThisProcess } from "../lib/llm/outOfProcessMetric.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const SIGNAL = "22222222-2222-4222-8222-222222222222";

const jobRow = (id: string) => ({
  id,
  organization_id: ORG,
  job_type: "control_matcher_suggest",
  status: "processing",
  attempts: 1,
  max_attempts: 3,
  payload: { signal_id: SIGNAL }
});

/** Queue `n` jobs for the tick to claim, then an empty result to end the drain. */
function queueJobs(n: number): void {
  const claim = pgElevated.query as ReturnType<typeof vi.fn>;
  claim.mockReset();
  for (let i = 0; i < n; i++) {
    claim.mockResolvedValueOnce({ rows: [jobRow(`job-${i}`)], rowCount: 1 });
  }
  claim.mockResolvedValue({ rows: [], rowCount: 0 });
}

/** The signal read inside processClaimedJob. */
function signalIsLoadable(): void {
  (pg.query as ReturnType<typeof vi.fn>).mockResolvedValue({
    rows: [
      {
        id: SIGNAL,
        signal_type: "vulnerability",
        severity: "Critical",
        normalized_summary: "summary"
      }
    ],
    rowCount: 1
  });
}

function tickEvents() {
  return (logger.info as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0])
    .filter((c) => c?.event === "control_matcher_tick_complete");
}

/** Simulate one matcher provider call + one cache miss, as the real path does. */
async function simulateMatcherWork(inputTokens: number, outputTokens: number): Promise<void> {
  recordVerdictCacheEvent({
    kind: "miss",
    organizationId: ORG,
    reason: "absent",
    lookupMs: 4
  });
  await withLlmCallContext({ purpose: LLM_CONTROL_MATCHER_PURPOSE, organizationId: ORG }, () => {
    recordLlmUsage({
      model: "claude-sonnet-4-6",
      tokens: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 1000,
      ok: true
    });
    return Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLlmRunAccumulationForTest();
  resetVerdictCacheAccumulationForTest();
  signalIsLoadable();
});

describe("control matcher tick telemetry", () => {
  it("aggregates the tick's matcher spend and cache lookups", async () => {
    queueJobs(2);
    (runControlMatcherWithOutcome as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await simulateMatcherWork(400, 50);
      return { written: 1, outcome: "written" as const, retryable: false };
    });

    const processed = await runOneTick();
    expect(processed).toBe(2);

    const [event] = tickEvents();
    expect(event.processed).toBe(2);
    // Two jobs, each one call and one lookup — the point of the rollup is that
    // this is a TOTAL, not a per-event line the reader has to sum by hand.
    expect(event.llm.calls).toBe(2);
    expect(event.llm.input_tokens).toBe(800);
    expect(event.llm.output_tokens).toBe(100);
    expect(event.llm.cost_usd).toBeGreaterThan(0);
    expect(event.verdict_cache.lookups).toBe(2);
    expect(event.verdict_cache.misses).toBe(2);
    expect(event.verdict_cache.hits).toBe(0);
  });

  it("names its aggregation boundary and does not claim a Brief run", async () => {
    queueJobs(1);
    await runOneTick();

    const [event] = tickEvents();
    expect(event.aggregation).toBe("worker_tick");
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    // Matcher work is asynchronous and routinely lands outside the Brief run
    // that enqueued it. Any per-run field here would be a fiction.
    expect(event).not.toHaveProperty("brief_run_id");
    expect(event).not.toHaveProperty("scheduler_run_id");
    expect(event).not.toHaveProperty("run_id");
  });

  it("EXCLUDES provider calls made for other purposes in the same process", async () => {
    // The intelligence worker also runs the hourly ingest cycle. Its calls land
    // in the same module-level accumulator, so an unfiltered total would report
    // ingestion spend as matcher spend.
    queueJobs(1);
    (runControlMatcherWithOutcome as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await simulateMatcherWork(400, 50);
      await withLlmCallContext({ purpose: "brief_item_enrichment", organizationId: ORG }, () => {
        recordLlmUsage({
          model: "claude-sonnet-4-6",
          tokens: {
            inputTokens: 99_999,
            outputTokens: 99_999,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          },
          latencyMs: 5000,
          ok: true
        });
        return Promise.resolve();
      });
      return { written: 1, outcome: "written" as const, retryable: false };
    });

    await runOneTick();

    const [event] = tickEvents();
    expect(event.llm.calls).toBe(1);
    expect(event.llm.input_tokens).toBe(400);
    expect(event.llm.output_tokens).toBe(50);
  });

  it("reports spend already incurred when the drain throws", async () => {
    queueJobs(2);
    let call = 0;
    (runControlMatcherWithOutcome as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      call += 1;
      await simulateMatcherWork(400, 50);
      if (call === 2) throw new Error("provider exploded");
      return { written: 1, outcome: "written" as const, retryable: false };
    });

    // processClaimedJob contains its own failures, so the tick completes; what
    // matters is that the accumulator is closed in `finally` either way.
    await runOneTick().catch(() => undefined);

    const events = tickEvents();
    expect(events.length).toBe(1);
    expect(events[0].llm.calls).toBeGreaterThanOrEqual(1);
  });

  it("carries no tenant data — it is operational telemetry, not a tenant surface", async () => {
    queueJobs(1);
    (runControlMatcherWithOutcome as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await simulateMatcherWork(400, 50);
      return { written: 1, outcome: "written" as const, retryable: false };
    });

    await runOneTick();

    const serialised = JSON.stringify(tickEvents()[0]);
    expect(serialised).not.toContain(ORG);
    expect(serialised).not.toContain(SIGNAL);
    // Per-org attribution stays on llm_call_usage / llm_verdict_cache_lookup,
    // which already carry organizationId per event and are org-scoped there.
    expect(tickEvents()[0]).not.toHaveProperty("by_organization");
  });

  it("emits nothing when the queue was empty — no zero-filled phantom tick", async () => {
    queueJobs(0);
    const processed = await runOneTick();

    expect(processed).toBe(0);
    expect(tickEvents()).toHaveLength(0);
  });

  it("does not steal an accumulation it did not open", async () => {
    // If some outer scope is already accumulating, an unconditional end() would
    // both report that scope's totals as the tick's AND leave the outer caller
    // with nothing. The tick reports null instead of lying.
    const { beginLlmRunAccumulation, endLlmRunAccumulation } = await import(
      "../lib/llm/llmTelemetry.js"
    );
    const { beginVerdictCacheAccumulation, endVerdictCacheAccumulation } = await import(
      "../lib/llm/verdictCacheMetrics.js"
    );

    beginLlmRunAccumulation();
    beginVerdictCacheAccumulation();
    queueJobs(1);
    (runControlMatcherWithOutcome as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await simulateMatcherWork(400, 50);
      return { written: 1, outcome: "written" as const, retryable: false };
    });

    await runOneTick();

    const [event] = tickEvents();
    expect(event.llm).toBeNull();
    expect(event.verdict_cache).toBeNull();
    // Null is "this tick did not own the measurement" — it must never be read
    // as zero, which is exactly the distinction this package exists to make.
    expect(isNotMeasuredInThisProcess(event.llm)).toBe(false);

    // The outer scope still gets its totals — nothing was stolen.
    const outerLlm = endLlmRunAccumulation();
    endVerdictCacheAccumulation();
    expect(outerLlm.by_purpose[LLM_CONTROL_MATCHER_PURPOSE]?.calls).toBe(1);
  });

  it("never lets telemetry fail the drain", async () => {
    queueJobs(1);
    (logger.info as ReturnType<typeof vi.fn>).mockImplementation((payload: { event?: string }) => {
      if (payload?.event === "control_matcher_tick_complete") throw new Error("log sink down");
    });

    await expect(runOneTick()).resolves.toBe(1);
  });
});
