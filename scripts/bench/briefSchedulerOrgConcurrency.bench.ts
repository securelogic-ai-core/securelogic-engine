/**
 * briefSchedulerOrgConcurrency.bench.ts — measured A/B of the weekly Brief
 * run's wall-clock, sequential vs bounded per-org concurrency.
 *
 * WHY THIS IS A BENCH AND NOT A TEST
 * ----------------------------------
 * It asserts nothing. It measures. Timing assertions in CI are flaky and, worse,
 * they invite the exact claim this file exists to avoid: "concurrency 2, so the
 * run is 2x faster." That is arithmetic, not evidence.
 *
 * WHAT IS REAL AND WHAT IS SYNTHETIC — READ BEFORE QUOTING A NUMBER
 * ----------------------------------------------------------------
 * REAL:      the scheduler under measurement (the actual runScheduler), the
 *            actual worker pool, the actual per-org step order, the actual
 *            merge. The A/B swaps ONLY briefScheduler.ts between git states.
 * SYNTHETIC: the per-org latency. The repository records no per-org timing for
 *            a production Brief run — `scheduler_cron_complete.durationMs` is
 *            logged but no captured value exists in any doc — so the costs
 *            below are PARAMETERS, not observations.
 *
 * Therefore the only quotable output is the RATIO between the two arms under an
 * identical synthetic profile. The absolute milliseconds mean nothing about
 * production, and the ratio is an upper bound on what production would see:
 * real orgs also contend for the database and the Anthropic rate limit, which
 * this harness does not simulate.
 *
 * PROFILES
 * --------
 * uniform — every org costs the same. The best case for a fixed pool.
 * skewed  — one org costs 10x the rest. This is the 2026-08-11 shape, where a
 *           single slow org delayed the entire tail, and it is the case the
 *           change actually targets.
 *
 * RUN
 * ---
 *   npx vitest run --config scripts/bench/vitest.bench.config.ts
 *
 * For the sequential arm, stash the implementation first:
 *   git stash push -- src/api/lib/briefScheduler.ts
 *   npx vitest run --config scripts/bench/vitest.bench.config.ts
 *   git stash pop
 */

import { describe, it, vi } from "vitest";

vi.mock("../../src/api/infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock("../../src/api/infra/postgres.js", () => ({
  pg: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  withTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => {
    await sleep(COST.db);
    return fn();
  }),
  requireTenantContext: vi.fn(() => ({}))
}));
vi.mock("../../src/api/infra/tenantContext.js", () => ({
  createSavepointClient: vi.fn(() => ({
    query: vi.fn(async () => ({ rows: [{ id: "brief-row" }], rowCount: 1 }))
  }))
}));
vi.mock("../../src/api/lib/cisaKevAdapter.js", () => ({
  fetchCisaKevSignals: vi.fn(async () => ({ signals: [], total: 0, fromCache: true }))
}));
vi.mock("../../src/api/lib/nvdAdapter.js", () => ({
  fetchNvdSignals: vi.fn(async () => ({ signals: [], total: 0, pages: 0 }))
}));
vi.mock("../../src/api/lib/secEdgarAdapter.js", () => ({
  fetchSecEdgarSignals: vi.fn(async () => ({ signals: [], total: 0, pages: 0 }))
}));
vi.mock("../../src/api/lib/federalRegisterAdapter.js", () => ({
  fetchFederalRegisterSignals: vi.fn(async () => ({ signals: [], total: 0, pages: 0 }))
}));
vi.mock("../../src/api/lib/feedHealth.js", () => ({
  recordFeedSuccess: vi.fn(async () => {}),
  recordFeedFailure: vi.fn(async () => {})
}));
vi.mock("../../src/api/lib/cisaAlertsAdapter.js", () => ({
  fetchCisaAlerts: vi.fn(async () => ({ signals: [], total: 0 }))
}));
vi.mock("../../src/api/lib/mitreAttackAdapter.js", () => ({
  fetchMitreAttackSignals: vi.fn(async () => ({ signals: [], total: 0, fromCache: true }))
}));
vi.mock("../../src/api/lib/mitreAtlasAdapter.js", () => ({
  fetchMitreAtlasSignals: vi.fn(async () => ({ signals: [], total: 0, fromCache: true }))
}));
vi.mock("../../src/api/lib/feedAdapter/index.js", () => ({
  fetchAllFeeds: vi.fn(async () => ({ signals: [], results: {} })),
  THREAT_INTEL_FEED_IDS: [],
  REGULATORY_FEED_IDS: []
}));
vi.mock("../../src/api/lib/cyberSignalValidation.js", () => ({
  validateCyberSignalIngest: vi.fn(() => ({ error: "unused" }))
}));
vi.mock("../../src/api/lib/cyberSignalNormalizer.js", () => ({
  normalizeSignal: vi.fn((s: unknown) => s)
}));
vi.mock("../../src/api/lib/cyberSignalProcessingService.js", () => ({
  processSignal: vi.fn(async () => {}),
  canonicalizeVendorName: vi.fn((s: string) => s)
}));
vi.mock("../../src/api/lib/intelligenceBriefGenerator.js", () => ({
  generateBrief: vi.fn(() => ({ shortlist: [], signal_count: 0 })),
  enrichBriefItems: vi.fn(async (_items: unknown, org: string) => {
    await sleep(costFor(org).enrich);
    return [];
  }),
  capByUrgencyBuckets: vi.fn((items: unknown[]) => ({
    items,
    counts: { immediate: 0, near_term: 0, far_term: 0 }
  })),
  finalizeBrief: vi.fn((base: unknown) => base),
  sourcePriority: vi.fn(() => 0)
}));
vi.mock("../../src/api/lib/signals/sourceQualification.js", () => ({
  sourceQualificationEnabled: vi.fn(() => false),
  loadSourceQualification: vi.fn(async () => new Map()),
  makeQualificationPriority: vi.fn(() => () => 0)
}));
vi.mock("../../src/api/lib/signals/sourceReliability.js", () => ({
  recomputeSourceReliability: vi.fn(async () => ({ total: 0, updated: 0 }))
}));
vi.mock("../../src/api/lib/signals/signalClustering.js", () => ({
  signalClusteringEnabled: vi.fn(() => false)
}));
vi.mock("../../src/api/lib/signals/briefProvenance.js", () => ({
  briefProvenanceEnabled: vi.fn(() => false),
  buildProvenanceRows: vi.fn(() => [])
}));
vi.mock("../../src/api/lib/briefPersonalizationService.js", () => ({
  personalizeBriefItems: vi.fn(async (items: unknown[]) => {
    await sleep(COST.personalize);
    return items;
  })
}));
vi.mock("../../src/api/lib/signals/intelligenceEventsFeatureFlag.js", () => ({
  intelligenceEventsEnabled: vi.fn(() => false)
}));
vi.mock("../../src/api/lib/signalRecencyFeatureFlag.js", () => ({
  signalRecencyEnabled: vi.fn(() => false)
}));
vi.mock("../../src/api/lib/briefRelevance.js", () => ({
  briefRelevanceEnabled: vi.fn(() => false),
  filterSignalsByOrgRelevance: vi.fn((rows: unknown[]) => ({ kept: rows, suppressed: [] }))
}));
vi.mock("../../src/api/lib/signals/eventBriefSource.js", () => ({
  fetchBriefEventRows: vi.fn(async () => [])
}));
vi.mock("../../src/api/lib/briefSynthesizer.js", () => ({
  runSynthesisSafely: vi.fn(async () => {
    await sleep(COST.synthesize);
    return null;
  }),
  fetchPriorBriefContext: vi.fn(async () => null)
}));
vi.mock("../../src/api/lib/briefEmailSender.js", () => ({
  sendBrief: vi.fn(async () => {
    await sleep(COST.send);
    return { sent: 1, failed: 0, skipped: false, already_sent: false };
  })
}));
vi.mock("../../src/api/lib/briefWebhookEmitter.js", () => ({
  emitBriefPublished: vi.fn(async () => {})
}));
vi.mock("../../src/api/lib/briefDeliveryHealth.js", () => ({
  maybeAlertBriefDelivery: vi.fn(async () => {})
}));
vi.mock("../../src/api/lib/briefEligibility.js", () => ({
  listBriefEligibleOrgIds: vi.fn(async () => ORGS)
}));

import { runScheduler } from "../../src/api/lib/briefScheduler.js";

// ---------------------------------------------------------------------------
// Workload parameters — SYNTHETIC. See the header.
// ---------------------------------------------------------------------------

/** Staging's current population (posture-worker swept 13 orgs, 2026-08-17). */
const ORG_COUNT = 13;

const ORGS = Array.from(
  { length: ORG_COUNT },
  (_, i) => `0${(i + 1).toString(16)}000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`
);

/**
 * Per-step cost, in milliseconds. Scaled down so the bench runs in seconds; the
 * RATIO between arms is what the profile controls, not the absolute figures.
 */
const COST = {
  db: 4,
  enrich: 60,
  personalize: 10,
  synthesize: 20,
  send: 15
};

/** In the skewed profile, org[0] is this many times more expensive to enrich. */
const SKEW_FACTOR = 10;

let profile: "uniform" | "skewed" = "uniform";

const costFor = (org: string): { enrich: number } => ({
  enrich: profile === "skewed" && org === ORGS[0] ? COST.enrich * SKEW_FACTOR : COST.enrich
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------

const TUESDAY = new Date("2026-07-07T12:00:00Z");

async function timeRun(): Promise<number> {
  const startedAt = performance.now();
  await runScheduler();
  return performance.now() - startedAt;
}

describe("brief scheduler org fan-out — wall clock", () => {
  it("measures both profiles", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TUESDAY);

    const results: Record<string, number> = {};
    for (const p of ["uniform", "skewed"] as const) {
      profile = p;
      await timeRun(); // warm-up, discarded
      const samples = [await timeRun(), await timeRun(), await timeRun()];
      results[p] = Math.min(...samples);
    }

    vi.useRealTimers();

    // Printed, not asserted. The comparison lives in the runbook that pairs
    // this arm's output with the other git state's.
    process.stdout.write(
      `\nBENCH orgs=${ORG_COUNT} ` +
        `uniform_ms=${results.uniform!.toFixed(0)} ` +
        `skewed_ms=${results.skewed!.toFixed(0)}\n`
    );
  }, 120_000);
});
