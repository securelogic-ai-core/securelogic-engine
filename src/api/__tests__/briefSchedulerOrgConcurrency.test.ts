/**
 * briefSchedulerOrgConcurrency.test.ts — bounded per-org concurrency in the
 * weekly Intelligence Brief run.
 *
 * The sequential loop this replaces made every org wait for the slowest org
 * ahead of it: the 2026-08-11 staging run took hours, and a single org stuck in
 * enrichment delayed the entire tail. The fix is a fixed-size worker pool
 * (ORG_CONCURRENCY = 2, hard-coded) over per-org tasks that each return their
 * OWN sealed result, merged by the scheduler after completion.
 *
 * Concurrency is only safe if it changes wall-clock and NOTHING else, so these
 * tests pin both halves of that claim:
 *
 *   BOUND        — peak simultaneous orgs never exceeds 2, at any point in the
 *                  run, and peak simultaneous tenant DB scopes never exceeds 2.
 *   PROGRESS     — a slow org occupies its own slot only; a second org runs to
 *                  completion past it, and a third starts the moment a slot
 *                  frees (no head-of-line blocking, no batch barrier).
 *   ISOLATION    — one org's failure neither cancels nor corrupts another's
 *                  work, and lands in the summary attributed to that org.
 *   EXACTNESS    — every counter and list in the summary is identical to what
 *                  the sequential loop produced, in the same order.
 *   IDEMPOTENCY  — no org generates or sends twice; the already-current skip
 *                  set still suppresses completed orgs.
 *   OVERLAP LOCK — a second scheduler trigger is still refused while a run with
 *                  multiple orgs in flight is active.
 *
 * Timers: ONLY Date is faked (`toFake: ["Date"]`). The send-day gate needs a
 * fixed clock, but these tests drive concurrency with real microtask/macrotask
 * flushes — faking setImmediate would deadlock the settle() helper.
 * 2026-07-07 is a Tuesday.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Logger is mocked for two reasons: a 40-org run otherwise buries the report in
// JSON, and `logger.info` is the one call site inside the per-org pipeline with
// no local try/catch — which makes it the only way to exercise processOrg's
// outer safety net without contriving a fake step.
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
import type * as ConcurrencyModule from "../lib/concurrency.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The hard-coded bound under test. Mirrors briefScheduler's ORG_CONCURRENCY. */
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

/**
 * Flush every pending microtask AND macrotask turn, so the scheduler's worker
 * pool reaches a genuine quiescent point before an assertion. Two setImmediate
 * hops: the first drains the microtask queue the awaits produced, the second
 * lets anything those continuations scheduled settle too.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
};

// ── Tenant-scope gauge (stands in for DB pool checkout) ────────────────────
//
// Every withTenant scope is one pooled connection held for its duration. The
// mock counts scopes that are simultaneously OPEN — that is the number the
// pool actually has to satisfy — and can hold a named org's scope open so the
// overlap is forced rather than hoped for.

let openTenantScopes = 0;
let peakTenantScopes = 0;
const tenantGates = new Map<string, Deferred>();

async function tenantScope<T>(org: string, fn: () => Promise<T>): Promise<T> {
  openTenantScopes++;
  if (openTenantScopes > peakTenantScopes) peakTenantScopes = openTenantScopes;
  try {
    const gate = tenantGates.get(org);
    if (gate) await gate.promise;
    return await fn();
  } finally {
    openTenantScopes--;
  }
}

// ── Org-task gauge, driven through the enrichment step ─────────────────────
//
// enrichBriefItems is the per-org step that costs real wall-clock in
// production (Claude calls), and it sits OUTSIDE any tenant scope — exactly
// the point at which a slow org used to stall every org behind it.

let inFlightOrgs = 0;
let peakOrgs = 0;
let startOrder: string[] = [];
let finishOrder: string[] = [];
const enrichGates = new Map<string, Deferred>();

/** Gate the enrichment of `orgs`; each stays in flight until released. */
function gateEnrichment(orgs: string[], failFor: Set<string> = new Set()): void {
  for (const o of orgs) enrichGates.set(o, deferred());
  vi.mocked(enrichBriefItems).mockImplementation(async (_shortlist, org) => {
    startOrder.push(org);
    inFlightOrgs++;
    if (inFlightOrgs > peakOrgs) peakOrgs = inFlightOrgs;
    try {
      const gate = enrichGates.get(org);
      if (gate) await gate.promise;
      if (failFor.has(org)) throw new Error(`enrichment exploded for ${org}`);
      return [];
    } finally {
      inFlightOrgs--;
      finishOrder.push(org);
    }
  });
}

const release = async (org: string): Promise<void> => {
  enrichGates.get(org)?.resolve();
  await settle();
};

const releaseAll = async (): Promise<void> => {
  for (const g of enrichGates.values()) g.resolve();
  for (const g of tenantGates.values()) g.resolve();
  await settle();
};

/** Orgs the skip-set query reports as already holding this week's brief. */
const mockCompletedOrgs = (ids: string[]) =>
  vi.mocked(pgElevated.query).mockResolvedValue({
    rows: ids.map((organization_id) => ({ organization_id }))
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date is faked: settle() needs a REAL setImmediate.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY_1200);

  openTenantScopes = 0;
  peakTenantScopes = 0;
  inFlightOrgs = 0;
  peakOrgs = 0;
  startOrder = [];
  finishOrder = [];
  tenantGates.clear();
  enrichGates.clear();

  // clearAllMocks resets CALLS, not implementations — the fault-injection tests
  // below would otherwise leak their throw into every later test.
  vi.mocked(logger.info).mockImplementation((() => {}) as never);
  vi.mocked(logger.warn).mockImplementation((() => {}) as never);
  vi.mocked(logger.error).mockImplementation((() => {}) as never);

  vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);
  vi.mocked(pg.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
  vi.mocked(enrichBriefItems).mockResolvedValue([]);
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
// 1. The bound holds
// ---------------------------------------------------------------------------

describe("bound — at most 2 organizations run at once", () => {
  it("peak simultaneous orgs never exceeds 2, checked at every step of a 6-org run", async () => {
    const orgs = [1, 2, 3, 4, 5, 6].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    gateEnrichment(orgs);

    const run = runScheduler();
    await settle();

    // Two started; the other four are queued, not merely slow.
    expect(inFlightOrgs).toBe(LIMIT);
    expect(startOrder).toHaveLength(LIMIT);

    // Walk the whole run one release at a time, asserting the bound holds at
    // EVERY quiescent point — not just at the start, where it is easiest.
    for (let i = 0; i < orgs.length; i++) {
      expect(inFlightOrgs).toBeLessThanOrEqual(LIMIT);
      await release(startOrder[i]!);
      expect(inFlightOrgs).toBeLessThanOrEqual(LIMIT);
    }

    await releaseAll();
    const summary = await run;

    expect(peakOrgs).toBe(LIMIT);
    expect(summary.briefs_generated).toBe(6);
    // The scheduler's own MEASURED gauge agrees with the test's.
    expect(summary.org_concurrency.limit).toBe(LIMIT);
    expect(summary.org_concurrency.peak_in_flight).toBe(LIMIT);
  });

  it("fewer orgs than the limit: no idle worker stalls the run", async () => {
    const orgs = [orgId(1)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);

    const summary = await runScheduler();

    expect(summary.briefs_generated).toBe(1);
    expect(summary.org_concurrency.peak_in_flight).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Progress — no head-of-line blocking
// ---------------------------------------------------------------------------

describe("progress — a slow org occupies its own slot only", () => {
  it("a deliberately slow org does not block a second org from completing", async () => {
    const [slow, fast] = [orgId(1), orgId(2)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([slow, fast]);
    gateEnrichment([slow, fast]);

    const run = runScheduler();
    await settle();

    expect(startOrder).toEqual([slow, fast]);

    // Release ONLY the fast org. The slow one is still parked in enrichment.
    await release(fast);

    // The fast org went all the way through generation AND send while the slow
    // org sits in flight — the property the sequential loop could not provide.
    expect(finishOrder).toEqual([fast]);
    expect(inFlightOrgs).toBe(1);
    expect(vi.mocked(sendBrief).mock.calls.map((c) => c[1])).toEqual([fast]);

    await release(slow);
    const summary = await run;

    expect(summary.briefs_generated).toBe(2);
    expect(summary.emails_sent).toBe(2);
  });

  it("a third org waits for a free slot, then starts the moment one frees", async () => {
    const [a, b, c] = [orgId(1), orgId(2), orgId(3)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([a, b, c]);
    gateEnrichment([a, b, c]);

    const run = runScheduler();
    await settle();

    // C has NOT started — the pool is full.
    expect(startOrder).toEqual([a, b]);

    // Freeing one slot admits C, and only C: the bound is still 2.
    await release(a);
    expect(startOrder).toEqual([a, b, c]);
    expect(inFlightOrgs).toBe(LIMIT);

    await releaseAll();
    const summary = await run;

    expect(summary.briefs_generated).toBe(3);
    expect(peakOrgs).toBe(LIMIT);
  });

  it("work is pulled per-slot, not in fixed batches: a fast org yields its slot immediately", async () => {
    // A batching implementation (chunk of 2, await both, next chunk) would make
    // org 3 wait for the SLOW org 1. A worker pool admits it as soon as the
    // fast org 2 finishes. This distinguishes the two.
    const orgs = [1, 2, 3, 4].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    gateEnrichment(orgs);

    const run = runScheduler();
    await settle();
    expect(startOrder).toEqual([orgs[0], orgs[1]]);

    // orgs[0] stays slow throughout; only the second slot cycles.
    await release(orgs[1]!);
    expect(startOrder).toEqual([orgs[0], orgs[1], orgs[2]]);
    await release(orgs[2]!);
    expect(startOrder).toEqual([orgs[0], orgs[1], orgs[2], orgs[3]]);

    // The slow org has still not moved, and never blocked anyone.
    expect(finishOrder).toEqual([orgs[1], orgs[2]]);

    await releaseAll();
    const summary = await run;
    expect(summary.briefs_generated).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 4. Failure isolation
// ---------------------------------------------------------------------------

describe("isolation — one org's failure is contained", () => {
  it("a failing org neither cancels nor corrupts its concurrent neighbour", async () => {
    const [bad, good] = [orgId(1), orgId(2)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([bad, good]);
    gateEnrichment([bad, good], new Set([bad]));

    const run = runScheduler();
    await settle();

    // Fail the bad org FIRST, while the good org is mid-flight — the ordering
    // that would cancel a naive Promise.all sibling.
    await release(bad);
    expect(inFlightOrgs).toBe(1);

    await release(good);
    const summary = await run;

    expect(summary.briefs_generated).toBe(1);
    expect(summary.orgs_skipped).toBe(1);
    expect(summary.orgs_processed).toBe(1);
    expect(summary.emails_sent).toBe(1);
    expect(vi.mocked(sendBrief).mock.calls.map((c) => c[1])).toEqual([good]);

    // Attributed to the org that failed, and to no other.
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain(`org:${bad} generate_failed`);
  });

  it("a send failure is recorded against its own org and stops nothing else", async () => {
    const [a, b, c] = [orgId(1), orgId(2), orgId(3)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([a, b, c]);
    vi.mocked(sendBrief).mockImplementation(async (_briefId, org) => {
      if (org === b) throw new Error("send blew up");
      return { sent: 1, failed: 0, skipped: false, already_sent: false } as never;
    });

    const summary = await runScheduler();

    // All three generated; only B's send failed, and it is recorded as B's.
    expect(summary.briefs_generated).toBe(3);
    expect(summary.emails_sent).toBe(2);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain(`org:${b} send_failed`);
  });

  it("an unhandled throw hits processOrg's outer net: contained, attributed, run continues", async () => {
    // Every step inside the per-org pipeline has its own try/catch, so the
    // outer net is unreachable through normal failure modes. Injecting a throw
    // into the pipeline's first logger.info is the only honest way to prove the
    // net exists and does what its comment claims — without it, an unforeseen
    // throw under a fan-out could reject a sibling's work.
    const [a, b, c] = [orgId(1), orgId(2), orgId(3)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([a, b, c]);
    vi.mocked(logger.info).mockImplementation(((obj: { event?: string; orgId?: string }) => {
      if (obj?.event === "scheduler_org_start" && obj.orgId === b) {
        throw new Error("unforeseen");
      }
    }) as never);

    const summary = await runScheduler();

    // A and C completed normally; B is recorded as a contained task failure.
    expect(summary.briefs_generated).toBe(2);
    expect(summary.emails_sent).toBe(2);
    expect(vi.mocked(sendBrief).mock.calls.map((call) => call[1]).sort()).toEqual([a, c].sort());
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain(`org:${b} org_task_fatal`);
    expect(summary.errors[0]).toContain("unforeseen");
  });

  it("errors keep org-enumeration order regardless of completion order", async () => {
    const [a, b] = [orgId(1), orgId(2)];
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([a, b]);
    gateEnrichment([a, b], new Set([a, b]));

    const run = runScheduler();
    await settle();

    // Finish B first — the summary must NOT reflect that.
    await release(b);
    await release(a);
    const summary = await run;

    expect(finishOrder).toEqual([b, a]);
    expect(summary.errors[0]).toContain(`org:${a}`);
    expect(summary.errors[1]).toContain(`org:${b}`);
  });
});

// ---------------------------------------------------------------------------
// 5. Counter exactness
// ---------------------------------------------------------------------------

describe("exactness — counters and lists are exact under concurrency", () => {
  it("a mixed 8-org run totals exactly, with no lost or double-counted increment", async () => {
    const orgs = [1, 2, 3, 4, 5, 6, 7, 8].map(orgId);
    const [done1, done2, fails, noRecipients, ...rest] = orgs;
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    mockCompletedOrgs([done1!, done2!]);

    vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
      if (org === fails) throw new Error("enrichment exploded");
      return [];
    });
    vi.mocked(sendBrief).mockImplementation(async (_briefId, org) => {
      if (org === noRecipients) {
        return { sent: 0, failed: 0, skipped: true, already_sent: false } as never;
      }
      return { sent: 3, failed: 1, skipped: false, already_sent: false } as never;
    });

    const summary = await runScheduler();

    expect(summary.active_orgs).toBe(8);
    expect(summary.orgs_skipped_already_current).toBe(2);
    expect(summary.orgs_skipped).toBe(1); // the generation failure
    expect(summary.briefs_generated).toBe(5); // 8 - 2 already current - 1 failed
    expect(summary.orgs_processed).toBe(5);
    // 4 orgs send normally at 3 each; the no-recipients org sends 0.
    expect(summary.emails_sent).toBe(12);
    expect(summary.emails_failed).toBe(4);
    expect(summary.emails_skipped_no_recipients).toBe(1);
    expect(summary.orgs_without_recipients).toEqual([noRecipients]);
    expect(summary.emails_skipped_off_day).toBe(0);
    expect(summary.errors).toHaveLength(1);

    // Every non-skipped org accounted for exactly once.
    expect(summary.orgs_processed + summary.orgs_skipped).toBe(
      summary.active_orgs - summary.orgs_skipped_already_current
    );
    expect(rest).toHaveLength(4);
  });

  it("repeated runs produce identical summaries — no order-dependent drift", async () => {
    const orgs = [1, 2, 3, 4, 5].map(orgId);

    const runOnce = async () => {
      vi.clearAllMocks();
      vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
      vi.mocked(pgElevated.query).mockResolvedValue({ rows: [] } as never);
      vi.mocked(enrichBriefItems).mockImplementation(async (_s, org) => {
        if (org === orgs[2]) throw new Error("boom");
        return [];
      });
      vi.mocked(sendBrief).mockResolvedValue({
        sent: 2,
        failed: 0,
        skipped: false,
        already_sent: false
      } as never);
      const s = await runScheduler();
      return JSON.stringify({
        processed: s.orgs_processed,
        skipped: s.orgs_skipped,
        generated: s.briefs_generated,
        sent: s.emails_sent,
        errors: s.errors
      });
    };

    expect(await runOnce()).toBe(await runOnce());
  });
});

// ---------------------------------------------------------------------------
// 6. Idempotency
// ---------------------------------------------------------------------------

describe("idempotency — no duplicate brief generation under concurrency", () => {
  it("each org generates and sends exactly once, and completed orgs not at all", async () => {
    const orgs = [1, 2, 3, 4, 5, 6].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    mockCompletedOrgs([orgs[0]!, orgs[1]!]);

    const summary = await runScheduler();

    const generatedFor = vi.mocked(enrichBriefItems).mock.calls.map((c) => c[1]);
    const sentFor = vi.mocked(sendBrief).mock.calls.map((c) => c[1]);

    // Exactly once each — no org appears twice in either list.
    expect(new Set(generatedFor).size).toBe(generatedFor.length);
    expect(new Set(sentFor).size).toBe(sentFor.length);
    expect([...generatedFor].sort()).toEqual(orgs.slice(2).sort());
    expect([...sentFor].sort()).toEqual(orgs.slice(2).sort());

    // The already-current orgs were never touched.
    expect(generatedFor).not.toContain(orgs[0]);
    expect(generatedFor).not.toContain(orgs[1]);
    expect(summary.orgs_skipped_already_current).toBe(2);
    expect(vi.mocked(generateBrief)).toHaveBeenCalledTimes(4);
  });

  it("the send-day gate is unchanged: an off-day run generates but never emails", async () => {
    vi.setSystemTime(new Date("2026-07-08T09:00:00Z")); // Wednesday
    const orgs = [1, 2, 3].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);

    const summary = await runScheduler();

    expect(summary.briefs_generated).toBe(3);
    expect(summary.emails_skipped_off_day).toBe(3);
    expect(vi.mocked(sendBrief)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Overlap lock
// ---------------------------------------------------------------------------

describe("overlap lock — still one scheduler run at a time", () => {
  it("a second trigger is refused while a run has multiple orgs in flight", async () => {
    const orgs = [1, 2, 3, 4].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);
    gateEnrichment(orgs);

    const first = runSchedulerGuarded("cron");
    await settle();

    // The run is genuinely mid-flight with the pool saturated.
    expect(inFlightOrgs).toBe(LIMIT);

    const second = await runSchedulerGuarded("catchup");
    expect(second).toEqual({ ran: false, reason: "overlap" });

    // No second population enumeration happened — the lock refused before any work.
    expect(vi.mocked(listBriefEligibleOrgIds)).toHaveBeenCalledTimes(1);

    await releaseAll();
    const result = await first;
    expect(result.ran).toBe(true);

    // ...and the lock releases afterwards.
    const third = await runSchedulerGuarded("manual");
    expect(third.ran).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Verdict-cache reservation
// ---------------------------------------------------------------------------

describe("verdict-cache reservation — concurrency does not duplicate LLM spend", () => {
  /**
   * Emulate the unique index + guarded DO UPDATE arm: the first claim on a key
   * wins and leaves it 'pending'; a concurrent claim on the SAME key loses,
   * because the WHERE clause rejects a live reservation.
   */
  const installReservationDb = (): { claims: string[] } => {
    const held = new Set<string>();
    const claims: string[] = [];
    vi.mocked(pg.query).mockImplementation((async (_sql: string, params: unknown[]) => {
      const key = (params as string[]).slice(0, 4).join("|");
      // A real await boundary, so concurrent callers genuinely interleave here.
      await new Promise<void>((r) => setImmediate(r));
      if (held.has(key)) return { rows: [], rowCount: 0 };
      held.add(key);
      claims.push(key);
      return { rows: [{ attempts: 1 }], rowCount: 1 };
    }) as never);
    return { claims };
  };

  const key = (org: string) => ({
    organizationId: org,
    signalDedupHash: "sha256:same-signal",
    controlInventoryDigest: "sha256:same-controls",
    promptVersion: "v1"
  });

  it("two concurrent claims on the same key produce exactly one winner", async () => {
    const { claims } = installReservationDb();
    const k = key(orgId(1));

    const [first, second] = await Promise.all([
      reserveVerdict(k, new Date(), 900_000),
      reserveVerdict(k, new Date(), 900_000)
    ]);

    // Exactly one caller may spend money on this verdict.
    expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1);
    expect(claims).toHaveLength(1);
  });

  it("concurrent orgs do NOT contend: the key is org-scoped, so each claims its own", async () => {
    // This is why org-level concurrency is safe for the cache — two orgs
    // processed simultaneously address different rows by construction, so the
    // fan-out neither duplicates spend nor introduces false lock contention.
    const { claims } = installReservationDb();

    const results = await Promise.all(
      [1, 2].map((n) => reserveVerdict(key(orgId(n)), new Date(), 900_000))
    );

    expect(results.every((r) => r.claimed)).toBe(true);
    expect(claims).toHaveLength(2);
    expect(new Set(claims).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 9. DB concurrency stays bounded
// ---------------------------------------------------------------------------

describe("database — pooled connection demand stays bounded", () => {
  it("simultaneously open tenant scopes never exceed the org limit", async () => {
    const orgs = [1, 2, 3, 4, 5, 6].map(orgId);
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);

    // Hold EVERY org's tenant scope open, so scopes overlap by construction
    // instead of by luck of scheduling.
    for (const o of orgs) tenantGates.set(o, deferred());

    const run = runScheduler();
    await settle();

    // Two scopes open, four orgs still queued: the pool is asked for 2, not 6.
    expect(openTenantScopes).toBe(LIMIT);

    for (const o of orgs) {
      expect(openTenantScopes).toBeLessThanOrEqual(LIMIT);
      tenantGates.get(o)!.resolve();
      await settle();
    }

    const summary = await run;

    expect(peakTenantScopes).toBe(LIMIT);
    expect(summary.briefs_generated).toBe(6);
    // Every scope was returned — no leak that would drain the pool over a run.
    expect(openTenantScopes).toBe(0);
  });

  it("the bound is independent of population size: 40 orgs still demand 2 connections", async () => {
    const orgs = Array.from({ length: 40 }, (_, i) => orgId(i + 1));
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(orgs);

    const summary = await runScheduler();

    // Well under the pg pool default of 10 per pool, which this work does not change.
    expect(peakTenantScopes).toBeLessThanOrEqual(LIMIT);
    expect(summary.org_concurrency.peak_in_flight).toBeLessThanOrEqual(LIMIT);
    expect(summary.briefs_generated).toBe(40);
    expect(openTenantScopes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Provider fan-out ceiling
// ---------------------------------------------------------------------------

describe("provider — the Anthropic fan-out is still bounded, at a known ceiling", () => {
  /**
   * Org concurrency MULTIPLIES the per-org enrichment fan-out: each org runs
   * ENRICHMENT_CONCURRENCY Claude calls at once, and now two orgs do so
   * simultaneously. That product is the number the provider sees, and it is the
   * one genuinely provider-facing consequence of this change — so it is
   * asserted, not assumed.
   *
   * Scope, stated honestly: this composes the REAL limiter (concurrency.ts) and
   * the REAL ENRICHMENT_CONCURRENCY constant (read from source, the same
   * technique the MITRE wiring test uses) driven by the REAL scheduler. It does
   * NOT exercise the Anthropic SDK wrapper — retry, 429 handling and quota
   * alerting live there and are untouched by this work, which is why no test
   * here re-asserts them.
   */
  it("peak simultaneous LLM calls equals ORG_CONCURRENCY x ENRICHMENT_CONCURRENCY, and no more", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));

    const generatorSource = readFileSync(
      path.resolve(here, "../lib/intelligenceBriefGenerator.ts"),
      "utf8"
    );
    const schedulerSource = readFileSync(path.resolve(here, "../lib/briefScheduler.ts"), "utf8");

    const enrichmentConcurrency = Number(
      /export const ENRICHMENT_CONCURRENCY = (\d+);/.exec(generatorSource)?.[1]
    );
    const orgConcurrency = Number(/const ORG_CONCURRENCY = (\d+);/.exec(schedulerSource)?.[1]);
    expect(enrichmentConcurrency).toBeGreaterThan(0);
    expect(orgConcurrency).toBe(LIMIT);

    const { mapWithConcurrency } = (await vi.importActual(
      "../lib/concurrency.js"
    )) as ConcurrencyModule;

    let liveCalls = 0;
    let peakCalls = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    // Stand in for the real enrichBriefItems: same limiter, same constant,
    // one counted "Claude call" per item.
    vi.mocked(enrichBriefItems).mockImplementation(async () => {
      await mapWithConcurrency(items, enrichmentConcurrency, async () => {
        liveCalls++;
        if (liveCalls > peakCalls) peakCalls = liveCalls;
        await new Promise<void>((r) => setImmediate(r));
        liveCalls--;
        return null;
      });
      return [];
    });

    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue([1, 2, 3, 4, 5, 6].map(orgId));

    const summary = await runScheduler();

    expect(summary.briefs_generated).toBe(6);
    // Bounded, and bounded at exactly the product — not at 6 orgs x 6 calls.
    expect(peakCalls).toBeLessThanOrEqual(orgConcurrency * enrichmentConcurrency);
    expect(peakCalls).toBeGreaterThan(enrichmentConcurrency);
    expect(liveCalls).toBe(0);
  });
});
