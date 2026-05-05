/**
 * kevPoller.test.ts — Verifies the 15-minute CISA KEV polling loop is wired
 * into the intelligence-worker scheduler and that runKevPoll() does the
 * right thing on cache-hit vs cold-fetch.
 *
 * STRUCTURAL TESTS (scheduler.ts source)
 * --------------------------------------
 * Mirror the pattern in briefSchedulerMitreWiring.test.ts. The behavioural
 * "errors don't propagate" guarantee comes from the existing setInterval
 * pattern — these structural tests catch the failures that actually matter:
 *   - import drift (runKevPoll not imported)
 *   - cadence drift (interval no longer 15 min)
 *   - startup-immediate regression (runKevPoll not called outside interval)
 *   - try/catch removal in the poller itself
 *   - log-event renames (kev_poll_completed / kev_poll_failed)
 *
 * UNIT TESTS (runKevPoll behaviour)
 * ---------------------------------
 *   - On fromCache=true the poller MUST NOT touch the DB (304 short-circuit
 *     is the steady state — any INSERT here means the cache logic is broken).
 *   - On fromCache=false the poller MUST run an INSERT per signal returned
 *     by the adapter, against the cyber_signals table with organization_id
 *     = NULL and ON CONFLICT DO NOTHING on the partial unique index.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../../../src/api/lib/cisaKevAdapter.js", () => ({
  fetchCisaKevSignals: vi.fn()
}));

vi.mock("../../../../src/api/infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

// Mock runMatcherForSignal so the fan-out path is observable without
// dragging in the matcher's full DB interactions. The active-orgs
// SELECT (which lives in kevPoller.ts itself, not in cyberSignalProcessingService)
// is mocked via the pg.query mock set up per-test.
vi.mock("../../../../src/api/lib/cyberSignalProcessingService.js", () => ({
  runMatcherForSignal: vi.fn().mockResolvedValue({
    matched_vendor_id: null,
    matched_ai_system_id: null,
    finding: null,
    suggestion_id: null,
    match_score: null,
    domain: "Vulnerability",
    matched_branch: "no_match"
  })
}));

import { runKevPoll } from "../kevPoller.js";
import { fetchCisaKevSignals } from "../../../../src/api/lib/cisaKevAdapter.js";
import { pg } from "../../../../src/api/infra/postgres.js";
import { runMatcherForSignal } from "../../../../src/api/lib/cyberSignalProcessingService.js";

const mockedFetchKev = vi.mocked(fetchCisaKevSignals);
const mockedPgQuery = vi.mocked(pg.query);
const mockedRunMatcher = vi.mocked(runMatcherForSignal);

const here = path.dirname(fileURLToPath(import.meta.url));
const schedulerSourcePath = path.resolve(here, "../scheduler.ts");
const kevPollerSourcePath = path.resolve(here, "../kevPoller.ts");
const schedulerSource = readFileSync(schedulerSourcePath, "utf8");
const kevPollerSource = readFileSync(kevPollerSourcePath, "utf8");

// ---------------------------------------------------------------------------
// Structural tests — scheduler.ts wiring
// ---------------------------------------------------------------------------

describe("scheduler.ts source — KEV fast-cadence wiring", () => {
  it("imports runKevPoll from the kevPoller module", () => {
    expect(schedulerSource).toMatch(
      /import\s*\{\s*runKevPoll\s*\}\s*from\s*"\.\/kevPoller\.js"/
    );
  });

  it("schedules a 15-minute setInterval for the KEV poll", () => {
    // Match either an inline literal (15 * 60 * 1000) or a named constant
    // resolving to the same value. The constant form (FIFTEEN_MINUTES_MS)
    // is what we ship today; the literal form is allowed so future style
    // refactors don't break the test for no reason.
    expect(schedulerSource).toMatch(
      /setInterval\([^)]*runKevPoll[^)]*(?:FIFTEEN_MINUTES_MS|15\s*\*\s*60\s*\*\s*1000)/
    );
  });

  it("defines the 15-minute cadence constant or literal", () => {
    expect(schedulerSource).toMatch(
      /(?:FIFTEEN_MINUTES_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000|setInterval\([^)]*15\s*\*\s*60\s*\*\s*1000)/
    );
  });

  it("calls runKevPoll once at startup BEFORE setInterval (not waiting 15 minutes for first poll)", () => {
    // The startup-immediate call must appear before the setInterval call —
    // otherwise the catalog is up to 15 minutes stale at boot. We assert
    // structure by looking for `await runKevPoll()` and `setInterval(runKevPoll`
    // both present, with the await call preceding the interval registration.
    const awaitIdx = schedulerSource.search(/await\s+runKevPoll\s*\(\s*\)/);
    const intervalIdx = schedulerSource.search(/setInterval\([^)]*runKevPoll/);

    expect(awaitIdx).toBeGreaterThan(-1);
    expect(intervalIdx).toBeGreaterThan(-1);
    expect(awaitIdx).toBeLessThan(intervalIdx);
  });

  it("does NOT replace the existing hourly runWorker setInterval", () => {
    // The fast-cadence poll is purely additive. The hourly cycle must remain.
    expect(schedulerSource).toMatch(
      /setInterval\([\s\S]*?runWorker\(\)[\s\S]*?ONE_HOUR_MS/
    );
  });
});

// ---------------------------------------------------------------------------
// Structural tests — kevPoller.ts shape
// ---------------------------------------------------------------------------

describe("kevPoller.ts source — shape", () => {
  it("imports fetchCisaKevSignals from the cache-aware adapter", () => {
    expect(kevPollerSource).toMatch(
      /import\s*\{\s*fetchCisaKevSignals\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/src\/api\/lib\/cisaKevAdapter\.js"/
    );
  });

  it("wraps the entire poll body in try/catch so failures cannot propagate", () => {
    // The whole runKevPoll body must be inside a try { ... } catch (err) { ... }
    // so a fetch or DB failure logs warn and returns rather than killing the
    // setInterval loop.
    expect(kevPollerSource).toMatch(/export\s+async\s+function\s+runKevPoll[\s\S]*?try\s*\{[\s\S]*?\}\s*catch\s*\(/);
  });

  it("logs kev_poll_completed on success and kev_poll_failed on error", () => {
    expect(kevPollerSource).toMatch(/event:\s*"kev_poll_completed"/);
    expect(kevPollerSource).toMatch(/event:\s*"kev_poll_failed"/);
  });

  it("surfaces fromCache in the completed log line for ops visibility", () => {
    // Two log emissions of kev_poll_completed (one debug for cache-hit, one
    // info for cold). Both must include fromCache so dashboards can chart
    // the 304 short-circuit rate.
    const completedBlocks = kevPollerSource.match(/kev_poll_completed[\s\S]{0,400}/g) ?? [];
    expect(completedBlocks.length).toBeGreaterThan(0);
    for (const block of completedBlocks) {
      expect(block).toMatch(/fromCache/);
    }
  });

  it("logs cache-hit at debug level (steady-state 304s should not flood info logs)", () => {
    expect(kevPollerSource).toMatch(/logger\.debug\([\s\S]*?kev_poll_completed[\s\S]*?fromCache:\s*true/);
  });

  it("inserts global rows (organization_id = NULL) with ON CONFLICT DO NOTHING on the partial unique index", () => {
    // The INSERT must target organization_id = NULL with the partial-index
    // conflict target so duplicates are silently skipped.
    expect(kevPollerSource).toMatch(/INSERT\s+INTO\s+cyber_signals/);
    expect(kevPollerSource).toMatch(/ON\s+CONFLICT\s*\(\s*dedup_hash\s*\)\s*WHERE\s+organization_id\s+IS\s+NULL\s+DO\s+NOTHING/);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — runKevPoll behaviour
// ---------------------------------------------------------------------------

describe("runKevPoll — behaviour", () => {
  beforeEach(() => {
    mockedFetchKev.mockReset();
    mockedPgQuery.mockReset();
    mockedRunMatcher.mockReset();
    // Default matcher behavior: returns no_match. Individual fan-out
    // tests override this with mockResolvedValueOnce.
    mockedRunMatcher.mockResolvedValue({
      matched_vendor_id: null,
      matched_ai_system_id: null,
      finding: null,
      suggestion_id: null,
      match_score: null,
      domain: "Vulnerability",
      matched_branch: "no_match"
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns without inserting when fromCache=true (304 short-circuit)", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [],
      total: 0,
      skipped: 0,
      fromCache: true
    });

    await runKevPoll();

    expect(mockedFetchKev).toHaveBeenCalledTimes(1);
    // The whole reason for a 304 short-circuit is to skip DB work.
    expect(mockedPgQuery).not.toHaveBeenCalled();
  });

  it("inserts every signal returned when fromCache=false", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "High",
          raw_payload: { cveID: "CVE-2026-0001" },
          normalized_summary: "Test KEV entry 1",
          affected_vendor: "AcmeCorp",
          affected_cve: "CVE-2026-0001"
        },
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "Critical",
          raw_payload: { cveID: "CVE-2026-0002" },
          normalized_summary: "Test KEV entry 2",
          affected_vendor: "Beta Inc",
          affected_cve: "CVE-2026-0002"
        }
      ],
      total: 2,
      skipped: 0,
      fromCache: false
    });

    // First insert "succeeds" (returns a row), second is a duplicate (no row).
    // After the inserts, the fan-out queries active orgs — return empty so
    // the fan-out is a no-op for this test (fan-out behavior is exercised
    // separately below).
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "row-1" }] } as never);
    mockedPgQuery.mockResolvedValueOnce({ rows: [] } as never);
    mockedPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    await runKevPoll();

    expect(mockedFetchKev).toHaveBeenCalledTimes(1);
    // 2 INSERTs + 1 active-orgs SELECT (fan-out's first query).
    expect(mockedPgQuery).toHaveBeenCalledTimes(3);

    // Verify the SQL is the global-row INSERT we expect.
    const firstCallSql = mockedPgQuery.mock.calls[0]![0] as string;
    expect(firstCallSql).toMatch(/INSERT\s+INTO\s+cyber_signals/);
    expect(firstCallSql).toMatch(/ON\s+CONFLICT\s*\(\s*dedup_hash\s*\)\s*WHERE\s+organization_id\s+IS\s+NULL\s+DO\s+NOTHING/);

    // Verify the bound parameters include the KEV CVE IDs (positional binding
    // means we just check they appear in the params array somewhere).
    const firstParams = mockedPgQuery.mock.calls[0]![1] as unknown[];
    expect(firstParams).toContain("CVE-2026-0001");
    expect(firstParams).toContain("cisa_kev");

    // Third query is the active-orgs lookup (fan-out's first action).
    const thirdCallSql = mockedPgQuery.mock.calls[2]![0] as string;
    expect(thirdCallSql).toMatch(/SELECT id FROM organizations WHERE status = 'active'/);

    // No fan-out invocations because active-orgs returned 0 rows.
    expect(mockedRunMatcher).not.toHaveBeenCalled();
  });

  it("does not throw when fetchCisaKevSignals rejects (errors are swallowed)", async () => {
    mockedFetchKev.mockRejectedValueOnce(new Error("network down"));

    // Must not throw — a fetch failure logs warn and the next interval tick
    // gets a fresh chance.
    await expect(runKevPoll()).resolves.toBeUndefined();
    expect(mockedPgQuery).not.toHaveBeenCalled();
  });

  it("continues the batch when a single-row INSERT fails", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "High",
          raw_payload: { cveID: "CVE-2026-0003" },
          normalized_summary: "row-fails",
          affected_vendor: null,
          affected_cve: "CVE-2026-0003"
        },
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "High",
          raw_payload: { cveID: "CVE-2026-0004" },
          normalized_summary: "row-succeeds",
          affected_vendor: null,
          affected_cve: "CVE-2026-0004"
        }
      ],
      total: 2,
      skipped: 0,
      fromCache: false
    });

    mockedPgQuery.mockRejectedValueOnce(new Error("constraint violation"));
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "ok" }] } as never);
    // Fan-out's active-orgs SELECT after the inserts — return empty so
    // this test stays focused on insert-batch resilience.
    mockedPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    // Single-row failure should not stop the batch — the second INSERT runs.
    await expect(runKevPoll()).resolves.toBeUndefined();
    // 2 INSERTs (one rejected, one resolved) + 1 active-orgs SELECT.
    expect(mockedPgQuery).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Fan-out behavior — runMatcherForSignal invocation pattern
// ---------------------------------------------------------------------------

describe("runKevPoll — matcher fan-out", () => {
  beforeEach(() => {
    mockedFetchKev.mockReset();
    mockedPgQuery.mockReset();
    mockedRunMatcher.mockReset();
    mockedRunMatcher.mockResolvedValue({
      matched_vendor_id: null,
      matched_ai_system_id: null,
      finding: null,
      suggestion_id: null,
      match_score: null,
      domain: "Vulnerability",
      matched_branch: "no_match"
    });
  });

  it("happy path: 2 KEV signals × 2 active orgs = 4 runMatcherForSignal invocations with correct (signal, org) pairs", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "Critical",
          raw_payload: { cveID: "CVE-2026-1001" },
          normalized_summary: "KEV one",
          affected_vendor: "VendorOne",
          affected_cve: "CVE-2026-1001"
        },
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "High",
          raw_payload: { cveID: "CVE-2026-1002" },
          normalized_summary: "KEV two",
          affected_vendor: "VendorTwo",
          affected_cve: "CVE-2026-1002"
        }
      ],
      total: 2,
      skipped: 0,
      fromCache: false
    });

    // Both INSERTs return new IDs.
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "signal-1" }] } as never);
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "signal-2" }] } as never);
    // Active-orgs SELECT returns 2 orgs.
    mockedPgQuery.mockResolvedValueOnce({
      rowCount: 2,
      rows: [{ id: "org-A" }, { id: "org-B" }]
    } as never);

    await runKevPoll();

    expect(mockedRunMatcher).toHaveBeenCalledTimes(4);
    // The 4 invocations cover all (signal, org) pairs.
    const pairs = mockedRunMatcher.mock.calls.map((c) => ({
      signalId: (c[0] as { id: string }).id,
      orgId: c[1]
    }));
    expect(pairs).toContainEqual({ signalId: "signal-1", orgId: "org-A" });
    expect(pairs).toContainEqual({ signalId: "signal-1", orgId: "org-B" });
    expect(pairs).toContainEqual({ signalId: "signal-2", orgId: "org-A" });
    expect(pairs).toContainEqual({ signalId: "signal-2", orgId: "org-B" });
  });

  it("0 active orgs: fan-out is a no-op (no runMatcherForSignal invocations)", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "High",
          raw_payload: { cveID: "CVE-2026-2001" },
          normalized_summary: "KEV solo",
          affected_vendor: null,
          affected_cve: "CVE-2026-2001"
        }
      ],
      total: 1,
      skipped: 0,
      fromCache: false
    });
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "signal-X" }] } as never);
    // Active orgs: 0 rows.
    mockedPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    await runKevPoll();

    expect(mockedRunMatcher).not.toHaveBeenCalled();
  });

  it("one (signal, org) pair throws: other pairs still get runMatcherForSignal calls", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "Critical",
          raw_payload: { cveID: "CVE-2026-3001" },
          normalized_summary: "KEV three",
          affected_vendor: null,
          affected_cve: "CVE-2026-3001"
        }
      ],
      total: 1,
      skipped: 0,
      fromCache: false
    });
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "signal-3" }] } as never);
    mockedPgQuery.mockResolvedValueOnce({
      rowCount: 3,
      rows: [{ id: "org-1" }, { id: "org-2" }, { id: "org-3" }]
    } as never);

    // First org throws; remaining two succeed.
    mockedRunMatcher.mockRejectedValueOnce(new Error("org-1 schema drift"));

    // Run should not throw — the per-pair try/catch isolates the failure.
    await expect(runKevPoll()).resolves.toBeUndefined();

    // All three orgs were attempted despite the first failure.
    expect(mockedRunMatcher).toHaveBeenCalledTimes(3);
    const orgIds = mockedRunMatcher.mock.calls.map((c) => c[1]);
    expect(orgIds).toEqual(["org-1", "org-2", "org-3"]);
  });

  it("active-orgs query failure: fan-out logs and returns; no runMatcherForSignal calls", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "High",
          raw_payload: { cveID: "CVE-2026-4001" },
          normalized_summary: "KEV four",
          affected_vendor: null,
          affected_cve: "CVE-2026-4001"
        }
      ],
      total: 1,
      skipped: 0,
      fromCache: false
    });
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "signal-4" }] } as never);
    // Active-orgs query rejects.
    mockedPgQuery.mockRejectedValueOnce(new Error("DB hiccup"));

    await expect(runKevPoll()).resolves.toBeUndefined();
    expect(mockedRunMatcher).not.toHaveBeenCalled();
  });

  it("0 inserted signals (all duplicates): fan-out is skipped entirely (no orgs query, no matcher calls)", async () => {
    mockedFetchKev.mockResolvedValueOnce({
      signals: [
        {
          source: "cisa_kev",
          signal_type: "cve",
          severity: "High",
          raw_payload: { cveID: "CVE-2026-5001" },
          normalized_summary: "dup",
          affected_vendor: null,
          affected_cve: "CVE-2026-5001"
        }
      ],
      total: 1,
      skipped: 0,
      fromCache: false
    });
    // INSERT returns no row (dedup hash collision).
    mockedPgQuery.mockResolvedValueOnce({ rows: [] } as never);

    await runKevPoll();

    // Only the INSERT ran — fan-out short-circuited because no signals
    // were inserted.
    expect(mockedPgQuery).toHaveBeenCalledTimes(1);
    expect(mockedRunMatcher).not.toHaveBeenCalled();
  });
});
