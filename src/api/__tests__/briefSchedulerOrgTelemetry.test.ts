/**
 * briefSchedulerOrgTelemetry.test.ts — per-org completion telemetry.
 *
 * WHY THIS EXISTS BEFORE ANY DEADLINE
 * -----------------------------------
 * Setting a per-org deadline requires knowing the per-org duration
 * distribution. The scheduler did not emit one. Answering "what deadline is
 * justified?" for the 2026-08-18 staging run meant reconstructing durations
 * from the GAPS BETWEEN consecutive `scheduler_org_start` lines — archaeology
 * that only works while a run is strictly sequential, and which the bounded
 * fan-out makes impossible. `scheduler_org_complete` replaces that with a
 * measurement.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   EXACTLY ONCE  — one completion event per org admitted to a slot, never two,
 *                   never zero; orgs skipped as already-current get none.
 *   DURATION      — measured from slot admission, per org, correct on the
 *                   success, generation-failure and outer-net paths alike.
 *   CONCURRENCY   — no duplicated or dropped events when orgs interleave, and
 *                   no org inherits another's clock.
 *   EXACTNESS     — the summary counters are unchanged by adding telemetry.
 *   NON-BLOCKING  — a throwing logger cannot fail, skip, or slow an org.
 *   DORMANCY      — `orgs_deadline_exceeded` exists as a shape and stays zero.
 *                   NOTHING here enforces a deadline.
 *
 * Timers: only Date is faked, so `settle()` keeps a real setImmediate while
 * `vi.setSystemTime` drives measured elapsed time. 2026-07-07 is a Tuesday.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  withTenant: vi.fn(async (orgId: string, fn: () => Promise<unknown>) => tenantScope(orgId, fn)),
  requireTenantContext: vi.fn(() => ({}))
}));
vi.mock("../infra/tenantContext.js", () => ({
  createSavepointClient: vi.fn(() => ({
    query: vi.fn(async () => ({ rows: [{ id: "brief-row" }], rowCount: 1 }))
  }))
}));
vi.mock("../lib/cisaKevAdapter.js", () => ({
  fetchCisaKevSignals: vi.fn(async () => ({ signals: [], total: 0, fromCache: true }))
}));
vi.mock("../lib/nvdAdapter.js", () => ({
  fetchNvdSignals: vi.fn(async () => ({ signals: [], total: 0, pages: 0 }))
}));
vi.mock("../lib/secEdgarAdapter.js", () => ({
  fetchSecEdgarSignals: vi.fn(async () => ({ signals: [], total: 0, pages: 0 }))
}));
vi.mock("../lib/federalRegisterAdapter.js", () => ({
  fetchFederalRegisterSignals: vi.fn(async () => ({ signals: [], total: 0, pages: 0 }))
}));
vi.mock("../lib/feedHealth.js", () => ({
  recordFeedSuccess: vi.fn(async () => {}),
  recordFeedFailure: vi.fn(async () => {})
}));
vi.mock("../lib/cisaAlertsAdapter.js", () => ({
  fetchCisaAlerts: vi.fn(async () => ({ signals: [], total: 0 }))
}));
vi.mock("../lib/mitreAttackAdapter.js", () => ({
  fetchMitreAttackSignals: vi.fn(async () => ({ signals: [], total: 0, fromCache: true }))
}));
vi.mock("../lib/mitreAtlasAdapter.js", () => ({
  fetchMitreAtlasSignals: vi.fn(async () => ({ signals: [], total: 0, fromCache: true }))
}));
vi.mock("../lib/feedAdapter/index.js", () => ({
  fetchAllFeeds: vi.fn(async () => ({ signals: [], results: {} })),
  THREAT_INTEL_FEED_IDS: [],
  REGULATORY_FEED_IDS: []
}));
vi.mock("../lib/cyberSignalValidation.js", () => ({
  validateCyberSignalIngest: vi.fn(() => ({ error: "unused" }))
}));
vi.mock("../lib/cyberSignalNormalizer.js", () => ({
  normalizeSignal: vi.fn((s: unknown) => s)
}));
vi.mock("../lib/cyberSignalProcessingService.js", () => ({
  processSignal: vi.fn(async () => {}),
  canonicalizeVendorName: vi.fn((s: string) => s)
}));
vi.mock("../lib/intelligenceBriefGenerator.js", () => ({
  generateBrief: vi.fn(() => ({ shortlist: [], signal_count: 0 })),
  enrichBriefItems: vi.fn(async () => []),
  capByUrgencyBuckets: vi.fn((items: unknown[]) => ({
    items,
    counts: { immediate: 0, near_term: 0, far_term: 0 }
  })),
  finalizeBrief: vi.fn((base: unknown) => base),
  sourcePriority: vi.fn(() => 0)
}));
vi.mock("../lib/signals/sourceQualification.js", () => ({
  sourceQualificationEnabled: vi.fn(() => false),
  loadSourceQualification: vi.fn(async () => new Map()),
  makeQualificationPriority: vi.fn(() => () => 0)
}));
vi.mock("../lib/signals/sourceReliability.js", () => ({
  recomputeSourceReliability: vi.fn(async () => ({ total: 0, updated: 0 }))
}));
vi.mock("../lib/signals/signalClustering.js", () => ({
  signalClusteringEnabled: vi.fn(() => false)
}));
vi.mock("../lib/signals/briefProvenance.js", () => ({
  briefProvenanceEnabled: vi.fn(() => false),
  buildProvenanceRows: vi.fn(() => [])
}));
vi.mock("../lib/briefPersonalizationService.js", () => ({
  personalizeBriefItems: vi.fn(async (items: unknown[]) => items)
}));
vi.mock("../lib/signals/intelligenceEventsFeatureFlag.js", () => ({
  intelligenceEventsEnabled: vi.fn(() => false)
}));
vi.mock("../lib/signalRecencyFeatureFlag.js", () => ({
  signalRecencyEnabled: vi.fn(() => false)
}));
vi.mock("../lib/briefRelevance.js", () => ({
  briefRelevanceEnabled: vi.fn(() => false),
  filterSignalsByOrgRelevance: vi.fn((rows: unknown[]) => ({ kept: rows, suppressed: [] }))
}));
vi.mock("../lib/signals/eventBriefSource.js", () => ({
  fetchBriefEventRows: vi.fn(async () => [])
}));
vi.mock("../lib/briefSynthesizer.js", () => ({
  runSynthesisSafely: vi.fn(async () => null),
  fetchPriorBriefContext: vi.fn(async () => null)
}));
vi.mock("../lib/briefEmailSender.js", () => ({
  sendBrief: vi.fn(async () => ({ sent: 1, failed: 0, skipped: false, already_sent: false }))
}));
vi.mock("../lib/briefWebhookEmitter.js", () => ({
  emitBriefPublished: vi.fn(async () => {})
}));
vi.mock("../lib/briefDeliveryHealth.js", () => ({
  maybeAlertBriefDelivery: vi.fn(async () => {})
}));
vi.mock("../lib/briefEligibility.js", () => ({
  listBriefEligibleOrgIds: vi.fn(async () => [])
}));

// schedulerRunner's other cron jobs — mocked so the overlap-lock test can
// import the REAL runSchedulerGuarded over the REAL briefScheduler.
vi.mock("node-cron", () => ({ schedule: vi.fn() }));
vi.mock("../lib/digestScheduler.js", () => ({ runDailyDigest: vi.fn() }));
vi.mock("../lib/summaryScheduler.js", () => ({ runWeeklySummary: vi.fn() }));
vi.mock("../lib/authAnomaly.js", () => ({ runAuthAnomalyScan: vi.fn() }));
vi.mock("../lib/postureSnapshotScheduler.js", () => ({ runDailyPostureSnapshots: vi.fn() }));
vi.mock("../lib/slaBreachScheduler.js", () => ({ runDailySlaBreachSweep: vi.fn() }));
vi.mock("../lib/briefStalenessMonitor.js", () => ({ runBriefStalenessCheck: vi.fn() }));
// briefSendWindow is intentionally REAL — the send-day gate is a contract here.

import { runScheduler } from "../lib/briefScheduler.js";
import { runSchedulerGuarded } from "../lib/schedulerRunner.js";
import { pg, pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { listBriefEligibleOrgIds } from "../lib/briefEligibility.js";
import { sendBrief } from "../lib/briefEmailSender.js";
import { enrichBriefItems, generateBrief } from "../lib/intelligenceBriefGenerator.js";
import { reserveVerdict } from "../lib/llm/verdictCache.js";
import {
  isNotMeasuredInThisProcess,
  NOT_MEASURED_IN_THIS_PROCESS
} from "../lib/llm/outOfProcessMetric.js";
import type * as ConcurrencyModule from "../lib/concurrency.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const LIMIT = 2;
const TUESDAY_1200 = new Date("2026-07-07T12:00:00Z");

const orgId = (n: number) =>
  `0${n.toString(16)}000000-0000-4000-8000-0000000000${n.toString().padStart(2, "0")}`;

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

async function tenantScope<T>(_org: string, fn: () => Promise<T>): Promise<T> {
  return fn();
}

/** Move the faked clock forward by `ms`, as elapsed work would. */
const advance = (ms: number): void => {
  vi.setSystemTime(new Date(Date.now() + ms));
};

type CompletionEvent = {
  event: string;
  organization_id: string;
  duration_ms: number;
  status: string;
  brief_generated: boolean;
  emails_sent: number;
  emails_failed: number;
  email_skipped_off_day: boolean;
  email_skipped_no_recipients: boolean;
  error_count: number;
  enrichment_total: number | null;
  enrichment_enriched: number | null;
  enrichment_fallback: number | null;
};

/** Every scheduler_org_complete emitted so far, in emission order. */
const completions = (): CompletionEvent[] =>
  vi
    .mocked(logger.info)
    .mock.calls.map((c) => c[0] as unknown as CompletionEvent)
    .filter((o) => o && o.event === "scheduler_org_complete");

const completionFor = (org: string): CompletionEvent | undefined =>
  completions().find((e) => e.organization_id === org);

/** An enrichment result with a controllable fallback split. */
const items = (enriched: number, fallback: number) => [
  ...Array.from({ length: enriched }, () => ({ enrichment_status: "enriched" })),
  ...Array.from({ length: fallback }, () => ({ enrichment_status: "fallback" }))
];

const mockCompletedOrgs = (ids: string[]) =>
  vi.mocked(pgElevated.query).mockResolvedValue({
    rows: ids.map((organization_id) => ({ organization_id }))
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY_1200);

  vi.mocked(logger.info).mockImplementation((() => {}) as never);
  vi.mocked(logger.warn).mockImplementation((() => {}) as never);
  vi.mocked(logger.error).mockImplementation((() => {}) as never);

  vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);
  vi.mocked(pg.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
  vi.mocked(enrichBriefItems).mockResolvedValue(items(24, 0) as never);
  vi.mocked(sendBrief).mockResolvedValue({
    sent: 1,
    failed: 0,
    skipped: false,
    already_sent: false
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Exactly one event per processed org
// ---------------------------------------------------------------------------

describe("exactly one completion event per processed org", () => {
  it("emits one per org admitted to a slot, and none for already-current skips", async () => {
    const orgs = [1, 2, 3, 4, 5].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    mockCompletedOrgs([orgs[0]!, orgs[1]!]);

    const summary = await runScheduler();

    const events = completions();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.organization_id).sort()).toEqual(orgs.slice(2).sort());

    // No duplicates.
    expect(new Set(events.map((e) => e.organization_id)).size).toBe(3);

    // Orgs skipped as already-current never entered a slot, so they have no
    // completion — their existing scheduler_org_skipped_already_current stands.
    expect(completionFor(orgs[0]!)).toBeUndefined();
    expect(completionFor(orgs[1]!)).toBeUndefined();
    expect(summary.orgs_skipped_already_current).toBe(2);
  });

  it("the event count matches the orgs the summary says were handled", async () => {
    const orgs = [1, 2, 3, 4, 5, 6].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      if (org === orgs[3]) throw new Error("boom");
      return items(24, 0) as never;
    });

    const summary = await runScheduler();

    expect(completions()).toHaveLength(
      summary.orgs_processed + summary.orgs_skipped + summary.orgs_task_fatal
    );
    expect(completions()).toHaveLength(6);
  });

  it("carries the org's outcome fields, including provider-degradation counters", async () => {
    const org = orgId(1);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    vi.mocked(enrichBriefItems).mockResolvedValue(items(20, 4) as never);
    vi.mocked(sendBrief).mockResolvedValue({
      sent: 3,
      failed: 1,
      skipped: false,
      already_sent: false
    } as never);

    await runScheduler();

    const e = completionFor(org)!;
    expect(e.status).toBe("succeeded");
    expect(e.brief_generated).toBe(true);
    expect(e.emails_sent).toBe(3);
    expect(e.emails_failed).toBe(1);
    expect(e.error_count).toBe(0);
    // The discriminator that separates "slow" from "provider failing".
    expect(e.enrichment_total).toBe(24);
    expect(e.enrichment_enriched).toBe(20);
    expect(e.enrichment_fallback).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 2. Duration correctness across every exit path
// ---------------------------------------------------------------------------

describe("duration is measured correctly on every path", () => {
  it("success: measures the whole org span", async () => {
    const org = orgId(1);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    vi.mocked(enrichBriefItems).mockImplementation(async () => {
      advance(5 * 60_000);
      return items(24, 0) as never;
    });

    await runScheduler();

    expect(completionFor(org)!.duration_ms).toBe(5 * 60_000);
    expect(completionFor(org)!.status).toBe("succeeded");
  });

  it("generation failure: still measured, and reported as generate_failed", async () => {
    const org = orgId(1);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    vi.mocked(enrichBriefItems).mockImplementation(async () => {
      advance(7 * 60_000);
      throw new Error("enrichment exploded");
    });

    const summary = await runScheduler();

    const e = completionFor(org)!;
    expect(e.duration_ms).toBe(7 * 60_000);
    expect(e.status).toBe("generate_failed");
    expect(e.brief_generated).toBe(false);
    expect(e.error_count).toBe(1);
    // Enrichment never returned, so the counters are null — not a fake zero.
    expect(e.enrichment_total).toBeNull();
    expect(summary.orgs_skipped).toBe(1);
  });

  it("outer net: a task that throws unexpectedly is still measured and reported", async () => {
    const org = orgId(1);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    // Throw from the pipeline's first logger.info — the one call site with no
    // local handler. The completion emit uses a different event and still runs.
    vi.mocked(logger.info).mockImplementation(((obj: { event?: string }) => {
      if (obj?.event === "scheduler_org_start") {
        advance(3 * 60_000);
        throw new Error("unforeseen");
      }
    }) as never);

    const summary = await runScheduler();

    const e = completionFor(org)!;
    expect(e.status).toBe("task_fatal");
    expect(e.duration_ms).toBe(3 * 60_000);
    expect(summary.errors[0]).toContain("org_task_fatal");
  });

  it("a send failure does not misreport the org as failed", async () => {
    const org = orgId(1);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    vi.mocked(sendBrief).mockRejectedValue(new Error("send blew up") as never);

    await runScheduler();

    // The brief WAS generated; only delivery failed. Status must reflect that,
    // or a dashboard would read a publishing failure that did not happen.
    const e = completionFor(org)!;
    expect(e.status).toBe("succeeded");
    expect(e.brief_generated).toBe(true);
    expect(e.error_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Under concurrency: no duplicates, none missing, no shared clocks
// ---------------------------------------------------------------------------

describe("under concurrent org processing", () => {
  it("12 interleaved orgs produce exactly 12 distinct events", async () => {
    const orgs = Array.from({ length: 12 }, (_, i) => orgId(i + 1));
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);

    let inFlight = 0;
    let peak = 0;
    const gates = new Map<string, Deferred>();
    for (const o of orgs) gates.set(o, deferred());
    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await gates.get(org)!.promise;
      inFlight--;
      return items(24, 0) as never;
    });

    const run = runScheduler();
    await settle();
    // Release in an order deliberately unrelated to enumeration order.
    for (const o of [...orgs].reverse()) {
      gates.get(o)!.resolve();
      await settle();
    }
    await runPending(gates);
    const summary = await run;

    const events = completions();
    expect(peak).toBe(LIMIT); // genuinely concurrent
    expect(events).toHaveLength(12);
    expect(new Set(events.map((e) => e.organization_id)).size).toBe(12);
    expect(events.map((e) => e.organization_id).sort()).toEqual([...orgs].sort());
    expect(summary.briefs_generated).toBe(12);
  });

  it("each org's duration is its own — a slow neighbour does not inflate it", async () => {
    const [slow, fast] = [orgId(1), orgId(2)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([slow, fast]);

    const gates = new Map<string, Deferred>([
      [slow, deferred()],
      [fast, deferred()]
    ]);
    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      await gates.get(org)!.promise;
      return items(24, 0) as never;
    });

    const run = runScheduler();
    await settle();

    // Both admitted at t0. Let 4 minutes pass, finish the fast org.
    advance(4 * 60_000);
    gates.get(fast)!.resolve();
    await settle();

    // 20 more minutes, then finish the slow one.
    advance(20 * 60_000);
    gates.get(slow)!.resolve();
    await settle();
    await run;

    expect(completionFor(fast)!.duration_ms).toBe(4 * 60_000);
    expect(completionFor(slow)!.duration_ms).toBe(24 * 60_000);
  });

  it("one org failing concurrently does not cost its neighbour an event", async () => {
    const [bad, good] = [orgId(1), orgId(2)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([bad, good]);
    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      if (org === bad) throw new Error("boom");
      return items(24, 0) as never;
    });

    await runScheduler();

    expect(completions()).toHaveLength(2);
    expect(completionFor(bad)!.status).toBe("generate_failed");
    expect(completionFor(good)!.status).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// 4. Summary counters unchanged by telemetry
// ---------------------------------------------------------------------------

describe("summary counters remain exact", () => {
  it("a mixed 8-org run totals exactly, as it did before telemetry existed", async () => {
    const orgs = [1, 2, 3, 4, 5, 6, 7, 8].map(orgId);
    const [done1, done2, fails, noRecipients] = orgs;
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    mockCompletedOrgs([done1!, done2!]);
    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      if (org === fails) throw new Error("enrichment exploded");
      return items(24, 0) as never;
    });
    vi.mocked(sendBrief).mockImplementation(async (_b, org) =>
      org === noRecipients
        ? ({ sent: 0, failed: 0, skipped: true, already_sent: false } as never)
        : ({ sent: 3, failed: 1, skipped: false, already_sent: false } as never)
    );

    const summary = await runScheduler();

    expect(summary.active_orgs).toBe(8);
    expect(summary.orgs_skipped_already_current).toBe(2);
    expect(summary.orgs_skipped).toBe(1);
    expect(summary.briefs_generated).toBe(5);
    expect(summary.orgs_processed).toBe(5);
    expect(summary.emails_sent).toBe(12);
    expect(summary.emails_failed).toBe(4);
    expect(summary.emails_skipped_no_recipients).toBe(1);
    expect(summary.orgs_without_recipients).toEqual([noRecipients]);
    expect(summary.errors).toHaveLength(1);

    // And the telemetry agrees with the summary rather than double-counting.
    const sent = completions().reduce((n, e) => n + e.emails_sent, 0);
    expect(sent).toBe(summary.emails_sent);
  });

  it("every org lands in exactly one bucket, including on the outer-net path", async () => {
    // The identity that closes the accounting hole: before orgs_task_fatal a
    // net-caught org appeared in `errors` but in no counter at all.
    const orgs = [1, 2, 3, 4, 5].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    mockCompletedOrgs([orgs[0]!]);
    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      if (org === orgs[1]) throw new Error("generation failed");
      return items(24, 0) as never;
    });
    vi.mocked(logger.info).mockImplementation(((obj: { event?: string; orgId?: string }) => {
      if (obj?.event === "scheduler_org_start" && obj.orgId === orgs[2]) {
        throw new Error("unforeseen");
      }
    }) as never);

    const summary = await runScheduler();

    expect(summary.orgs_skipped_already_current).toBe(1);
    expect(summary.orgs_skipped).toBe(1); // generation failure
    expect(summary.orgs_task_fatal).toBe(1); // outer net
    expect(summary.orgs_processed).toBe(2);
    expect(
      summary.orgs_processed + summary.orgs_skipped + summary.orgs_task_fatal
    ).toBe(summary.active_orgs - summary.orgs_skipped_already_current);

    // One completion event per admitted org, each with its own status.
    const byStatus = completions().reduce<Record<string, number>>((acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(byStatus).toEqual({ succeeded: 2, generate_failed: 1, task_fatal: 1 });
  });
});

// ---------------------------------------------------------------------------
// 5. Telemetry cannot block or fail the scheduler
// ---------------------------------------------------------------------------

describe("telemetry is never load-bearing", () => {
  it("a logger that throws on the completion event cannot fail or skip any org", async () => {
    const orgs = [1, 2, 3, 4].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    vi.mocked(logger.info).mockImplementation(((obj: { event?: string }) => {
      if (obj?.event === "scheduler_org_complete") {
        throw new Error("log transport down");
      }
    }) as never);

    const summary = await runScheduler();

    // Every org still generated and sent; the run reports no error at all.
    expect(summary.briefs_generated).toBe(4);
    expect(summary.orgs_processed).toBe(4);
    expect(summary.emails_sent).toBe(4);
    expect(summary.errors).toHaveLength(0);
    expect(summary.orgs_skipped).toBe(0);
  });

  it("a logger that throws on every ORG-scoped call still completes the run", async () => {
    // Scope note, stated honestly: the scheduler's RUN-level logging
    // (scheduler_run_start, scheduler_run_complete, feed-fetch lines) is not
    // wrapped and never has been — a wholly dead log transport would still
    // break a run. That is pre-existing and outside this package. What this
    // package owns is the per-org path, and that is what is asserted here:
    // every org-scoped log call throwing must not cost an org its outcome.
    const orgs = [1, 2, 3].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    vi.mocked(logger.info).mockImplementation(((obj: Record<string, unknown>) => {
      if (obj && (obj["orgId"] !== undefined || obj["organization_id"] !== undefined)) {
        throw new Error("log transport down");
      }
    }) as never);

    const summary = await runScheduler();

    // The run completes and every org is accounted for exactly once; each is
    // contained by the outer net rather than aborting the run or a sibling.
    expect(summary.active_orgs).toBe(3);
    expect(
      summary.orgs_processed + summary.orgs_skipped + summary.orgs_task_fatal
    ).toBe(3);
    expect(summary.orgs_task_fatal).toBe(3);
    expect(summary.errors).toHaveLength(3);
    expect(summary.errors.every((e) => e.includes("org_task_fatal"))).toBe(true);
  });

  it("the completion emit itself is wrapped — a throw there is swallowed whole", async () => {
    // Narrowest possible statement of the contract: ONLY the completion event
    // throws. Nothing else in the org path is disturbed, so if the emit were
    // unwrapped this org would fail; it must instead succeed silently.
    const org = orgId(1);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    vi.mocked(logger.info).mockImplementation(((obj: { event?: string }) => {
      if (obj?.event === "scheduler_org_complete") throw new Error("boom");
    }) as never);

    const summary = await runScheduler();

    expect(summary.briefs_generated).toBe(1);
    expect(summary.orgs_processed).toBe(1);
    expect(summary.errors).toHaveLength(0);
    // No error was logged either — the swallow is total, not a downgrade to
    // logger.error, which would be unsafe when logger.info just threw.
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. The deadline shape is DORMANT
// ---------------------------------------------------------------------------

describe("orgs_deadline_exceeded is a dormant shape, not enforcement", () => {
  it("stays zero across success, failure, fatal and very slow orgs", async () => {
    const orgs = [1, 2, 3].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      if (org === orgs[1]) throw new Error("boom");
      // Twelve hours: longer than any deadline anyone would propose.
      advance(12 * 60 * 60_000);
      return items(24, 0) as never;
    });

    const summary = await runScheduler();

    expect(summary.orgs_deadline_exceeded).toBe(0);
    expect(summary.orgs_deadline_exceeded_ids).toEqual([]);
    // The slow orgs completed. Nothing was cut short.
    expect(summary.briefs_generated).toBe(2);
    expect(completions().some((e) => e.duration_ms >= 12 * 60 * 60_000)).toBe(true);
    expect(completions().every((e) => e.status !== "deadline_exceeded")).toBe(true);
  });

  it("the source contains no deadline enforcement machinery", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.resolve(here, "../lib/briefScheduler.ts"), "utf8");

    // No timer, no racing, no abort plumbing anywhere in the scheduler.
    expect(source).not.toMatch(/setTimeout|setInterval|AbortController|AbortSignal|Promise\.race/);
    // The counter exists but is never incremented or appended to.
    expect(source).toMatch(/orgs_deadline_exceeded: 0/);
    expect(source).not.toMatch(/orgs_deadline_exceeded\+\+|orgs_deadline_exceeded \+=/);
    expect(source).not.toMatch(/orgs_deadline_exceeded_ids\.push/);
  });
});

describe("the scheduler never publishes a metric it did not measure", () => {
  // The Wave 4 Tier 2 gate (#826) read `verdict_cache: {hits:0, lookups:0,
  // tokens_saved:0}` off a run summary and concluded the cache did nothing.
  // Those zeros were not a measurement: since Wave 4 the verdict cache is
  // reachable only from the matcher worker's process, which this one does not
  // start. A zero the process cannot produce is worse than a missing field,
  // because it reads as evidence.

  it("reports verdict_cache as NOT MEASURED HERE rather than zeros", async () => {
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([1, 2].map(orgId));

    const summary = await runScheduler();

    expect(isNotMeasuredInThisProcess(summary.verdict_cache)).toBe(true);
    expect(summary.verdict_cache.measurement).toBe(NOT_MEASURED_IN_THIS_PROCESS);
    // Nothing summable, so a dashboard cannot fold this into a total by accident.
    expect(summary.verdict_cache).not.toHaveProperty("hits");
    expect(summary.verdict_cache).not.toHaveProperty("lookups");
    expect(summary.verdict_cache).not.toHaveProperty("tokens_saved");
    expect(summary.verdict_cache).not.toHaveProperty("cost_saved_usd");
  });

  it("points the reader at the process and event that CAN answer", async () => {
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([orgId(1)]);

    const summary = await runScheduler();

    expect(summary.verdict_cache.producer).toBe("securelogic-intelligence-worker");
    expect(summary.verdict_cache.event).toBe("control_matcher_tick_complete");
  });

  it("still reports its OWN llm spend as real numbers — this is not blanket silence", async () => {
    // Brief-synthesis calls do happen in this process, so `llm` stays numeric.
    // The correction is scoped to what the scheduler cannot see, not to
    // everything expensive.
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([orgId(1)]);

    const summary = await runScheduler();

    expect(typeof summary.llm.calls).toBe("number");
    expect(typeof summary.llm.cost_usd).toBe("number");
    expect(isNotMeasuredInThisProcess(summary.llm)).toBe(false);
    // …and it never grows a matcher bucket, because that work is elsewhere.
    expect(summary.llm.by_purpose).not.toHaveProperty("llm_control_matcher");
  });

  it("scheduler_run_complete carries the measured concurrency bound", async () => {
    // #826 reconstructed peak concurrency from scheduler_org_start/_complete
    // interval pairs while the measured value sat in the summary, absent from
    // this line only. Emitting it is the difference between a run that
    // evidences itself and one that needs an analyst.
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([1, 2, 3].map(orgId));

    await runScheduler();

    const complete = vi
      .mocked(logger.info)
      .mock.calls.map((c) => c[0] as Record<string, unknown>)
      .find((c) => c?.event === "scheduler_run_complete");

    expect(complete).toBeDefined();
    const concurrency = complete!["org_concurrency"] as { limit: number; peak_in_flight: number };
    expect(concurrency.limit).toBeGreaterThan(0);
    expect(concurrency.peak_in_flight).toBeGreaterThan(0);
    expect(concurrency.peak_in_flight).toBeLessThanOrEqual(concurrency.limit);
  });

  it("scheduler_run_complete does not print zeroed llm totals it cannot have yet", async () => {
    // The LLM accumulator closes in runScheduler(), one frame ABOVE this emit,
    // so any numbers on this line would necessarily be zeros. It says so
    // instead, and names scheduler_cron_complete as the line that has them.
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([orgId(1)]);

    await runScheduler();

    const complete = vi
      .mocked(logger.info)
      .mock.calls.map((c) => c[0] as Record<string, unknown>)
      .find((c) => c?.event === "scheduler_run_complete");

    expect(isNotMeasuredInThisProcess(complete!["llm"])).toBe(true);
    expect(isNotMeasuredInThisProcess(complete!["verdict_cache"])).toBe(true);
    expect((complete!["llm"] as { event: string }).event).toBe("scheduler_cron_complete");
  });
});

/** Release any gate still outstanding, so a failed assertion cannot hang. */
async function runPending(gates: Map<string, Deferred>): Promise<void> {
  for (const g of gates.values()) g.resolve();
  await settle();
}

// ---------------------------------------------------------------------------
// EMAIL-OBS-1 / F-3: scheduler_brief_sent must carry EVERY send counter
// ---------------------------------------------------------------------------

describe("scheduler_brief_sent carries every SendBriefResult counter", () => {
  const sentLines = () =>
    vi
      .mocked(logger.info)
      .mock.calls.map((c) => c[0] as unknown as Record<string, unknown>)
      .filter((o) => o && o.event === "scheduler_brief_sent");

  it("a zero-send run explains itself: suppressed and skipped_filtered are on the line", async () => {
    const org = orgId(1);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    // F-3's real shape: one subscriber, suppressed — previously logged as
    // "sent 0 failed 0 skipped false already_sent 0", i.e. all zeros.
    vi.mocked(sendBrief).mockResolvedValue({
      sent: 0, failed: 0, skipped: false, skipped_filtered: 1, suppressed: 2, already_sent: 0
    } as never);

    await runScheduler();

    const lines = sentLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      orgId: org,
      attempted: 0,
      accepted: 0,
      rejected: 0,
      sent: 0,
      failed: 0,
      suppressed: 2,
      skipped_filtered: 1,
      skipped: false,
      already_sent: 0
    });
    expect(typeof lines[0]!.briefId).toBe("string");
  });

  it("attempted = accepted + rejected", async () => {
    const org = orgId(2);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([org]);
    vi.mocked(sendBrief).mockResolvedValue({
      sent: 3, failed: 2, skipped: false, skipped_filtered: 0, suppressed: 0, already_sent: 1
    } as never);

    await runScheduler();

    expect(sentLines()[0]).toMatchObject({ attempted: 5, accepted: 3, rejected: 2, already_sent: 1 });
  });
});
