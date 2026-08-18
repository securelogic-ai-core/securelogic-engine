/**
 * briefSchedulerReconciliation.test.ts — per-org idempotency of the weekly
 * Brief scheduler run.
 *
 * The 2026-08-11 staging failure: the sequential multi-hour Tuesday run was
 * killed mid-loop by a deploy SIGTERM after 9 of 12 orgs published; the tail
 * orgs silently missed the week's edition. Recovery requires a rerun — and a
 * rerun is only safe if completed orgs are skipped, not regenerated and
 * re-emailed. These tests pin that contract end-to-end through runScheduler():
 *
 *   - orgs holding this week's published brief are skipped
 *     (scheduler_org_skipped_already_current, no generation, no send);
 *   - missing orgs are reconciled (generated exactly once);
 *   - a Wednesday+ rerun (the catch-up path) generates but NEVER emails —
 *     the isBriefSendDay gate is unchanged;
 *   - the skip-set query FAILS OPEN (a detection error must never block the
 *     weekly edition);
 *   - one org's generation failure does not prevent reconciliation of the
 *     remaining eligible orgs.
 *
 * All feed adapters are mocked to return zero signals (ingest is out of scope
 * here — its ON CONFLICT DO NOTHING dedup is unaffected by rerun semantics).
 * 2026-07-07 is a Tuesday; 2026-07-08 a Wednesday.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  withTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
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
  capByUrgencyBuckets: vi.fn(() => ({
    items: [],
    counts: { immediate: 0, near_term: 0, far_term: 0 }
  })),
  finalizeBrief: vi.fn(() => ({
    items: [],
    signal_count: 0,
    item_count: 0,
    content_json: {},
    content_markdown: ""
  })),
  sourcePriority: vi.fn(() => 0)
}));
vi.mock("../lib/signals/sourceQualification.js", () => ({
  sourceQualificationEnabled: vi.fn(() => false),
  loadSourceQualification: vi.fn(async () => new Map()),
  makeQualificationPriority: vi.fn(() => () => 0)
}));
vi.mock("../lib/signals/sourceReliability.js", () => ({
  recomputeSourceReliability: vi.fn(async () => {})
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
  filterSignalsByOrgRelevance: vi.fn(() => ({ kept: [], suppressed: [] }))
}));
vi.mock("../lib/signals/eventBriefSource.js", () => ({
  fetchBriefEventRows: vi.fn(async () => [])
}));
vi.mock("../lib/briefSynthesizer.js", () => ({
  runSynthesisSafely: vi.fn(async () => null),
  fetchPriorBriefContext: vi.fn(async () => null)
}));
vi.mock("../lib/briefEmailSender.js", () => ({
  sendBrief: vi.fn(async () => ({ sent: 0, failed: 0, skipped: false, already_sent: 0 }))
}));
vi.mock("../lib/briefWebhookEmitter.js", () => ({
  emitBriefPublished: vi.fn()
}));
vi.mock("../lib/briefDeliveryHealth.js", () => ({
  maybeAlertBriefDelivery: vi.fn(async () => {})
}));
vi.mock("../lib/briefEligibility.js", () => ({
  listBriefEligibleOrgIds: vi.fn(async () => [])
}));
// briefSendWindow is intentionally REAL: isBriefSendDay and
// currentBriefWeekStart are the pure contracts under test.

import { runScheduler } from "../lib/briefScheduler.js";
import { pgElevated, withTenant } from "../infra/postgres.js";
import { listBriefEligibleOrgIds } from "../lib/briefEligibility.js";
import { sendBrief } from "../lib/briefEmailSender.js";
import { enrichBriefItems, generateBrief } from "../lib/intelligenceBriefGenerator.js";

const ORG_A = "0a000000-0000-4000-8000-000000000001";
const ORG_B = "0b000000-0000-4000-8000-000000000002";
const ORG_C = "0c000000-0000-4000-8000-000000000003";
const ORG_D = "0d000000-0000-4000-8000-000000000004";
const ALL_ORGS = [ORG_A, ORG_B, ORG_C, ORG_D];

const TUESDAY_1200 = new Date("2026-07-07T12:00:00Z");
const WEDNESDAY_0900 = new Date("2026-07-08T09:00:00Z");
const THIS_WEEK_START = "2026-07-07T07:00:00.000Z";

/** Orgs the skip-set query reports as already holding this week's brief. */
const mockCompletedOrgs = (ids: string[]) =>
  vi.mocked(pgElevated.query).mockResolvedValue({
    rows: ids.map((organization_id) => ({ organization_id }))
  } as never);

const tenantOrgIds = () => vi.mocked(withTenant).mock.calls.map((c) => c[0]);

describe("runScheduler — per-org idempotent rerun (reconciliation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(listBriefEligibleOrgIds).mockResolvedValue(ALL_ORGS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("interrupted-run rerun: completed orgs are skipped, missing orgs reconciled, no duplicates", async () => {
    vi.setSystemTime(TUESDAY_1200);
    mockCompletedOrgs([ORG_A, ORG_B]); // published before the interruption

    const summary = await runScheduler();

    // Completed orgs skipped — no regeneration (scenario: completed skipped).
    expect(summary.orgs_skipped_already_current).toBe(2);
    expect(tenantOrgIds()).not.toContain(ORG_A);
    expect(tenantOrgIds()).not.toContain(ORG_B);

    // Missing orgs reconciled, exactly once each (scenarios: missing
    // reconciled + rerun without duplicate briefs).
    expect(summary.briefs_generated).toBe(2);
    expect(summary.orgs_processed).toBe(2);
    expect(vi.mocked(generateBrief)).toHaveBeenCalledTimes(2);

    // Send-day (Tuesday): only the newly generated orgs are emailed.
    expect(vi.mocked(sendBrief)).toHaveBeenCalledTimes(2);
    const sentOrgs = vi.mocked(sendBrief).mock.calls.map((c) => c[1]);
    expect(sentOrgs.sort()).toEqual([ORG_C, ORG_D]);

    // The skip set was computed against the current weekly window boundary.
    expect(vi.mocked(pgElevated.query).mock.calls[0]?.[1]).toEqual([THIS_WEEK_START]);
  });

  it("fully complete week: every org skipped, nothing generated, nothing sent", async () => {
    vi.setSystemTime(TUESDAY_1200);
    mockCompletedOrgs(ALL_ORGS);

    const summary = await runScheduler();

    expect(summary.orgs_skipped_already_current).toBe(4);
    expect(summary.briefs_generated).toBe(0);
    expect(vi.mocked(withTenant)).not.toHaveBeenCalled();
    expect(vi.mocked(sendBrief)).not.toHaveBeenCalled();
  });

  it("Wednesday catch-up rerun generates the missing orgs but NEVER emails (send-day control preserved)", async () => {
    vi.setSystemTime(WEDNESDAY_0900);
    mockCompletedOrgs([ORG_A, ORG_B]);

    const summary = await runScheduler();

    // Wednesday is inside the same weekly window (most recent Tuesday 07:00),
    // so the Tuesday-published orgs still count as complete...
    expect(summary.orgs_skipped_already_current).toBe(2);
    // ...the missing tail generates...
    expect(summary.briefs_generated).toBe(2);
    // ...and NO email leaves on a non-send day (scenario: no unintended
    // Wednesday+ email).
    expect(vi.mocked(sendBrief)).not.toHaveBeenCalled();
    expect(summary.emails_skipped_off_day).toBe(2);
    expect(summary.emails_sent).toBe(0);
  });

  it("skip-set query failure FAILS OPEN: the run proceeds for every org as before the idempotency change", async () => {
    vi.setSystemTime(TUESDAY_1200);
    vi.mocked(pgElevated.query).mockRejectedValue(new Error("db blip") as never);

    const summary = await runScheduler();

    expect(summary.orgs_skipped_already_current).toBe(0);
    expect(summary.briefs_generated).toBe(4);
  });

  it("one org's generation failure does not prevent reconciliation of the remaining orgs", async () => {
    vi.setSystemTime(TUESDAY_1200);
    mockCompletedOrgs([ORG_A, ORG_B]);
    vi.mocked(enrichBriefItems).mockImplementation(async (_shortlist, orgId) => {
      if (orgId === ORG_C) throw new Error("enrichment exploded");
      return [];
    });

    const summary = await runScheduler();

    // C failed and was recorded; D still reconciled and (Tuesday) sent.
    expect(summary.briefs_generated).toBe(1);
    expect(summary.orgs_skipped).toBe(1);
    expect(summary.errors.some((e) => e.includes(`org:${ORG_C} generate_failed`))).toBe(true);
    expect(vi.mocked(sendBrief)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendBrief).mock.calls[0]?.[1]).toBe(ORG_D);
    // Completed orgs stayed skipped throughout.
    expect(summary.orgs_skipped_already_current).toBe(2);
  });
});
