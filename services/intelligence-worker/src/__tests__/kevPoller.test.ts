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

import { runKevPoll } from "../kevPoller.js";
import { fetchCisaKevSignals } from "../../../../src/api/lib/cisaKevAdapter.js";
import { pg } from "../../../../src/api/infra/postgres.js";

const mockedFetchKev = vi.mocked(fetchCisaKevSignals);
const mockedPgQuery = vi.mocked(pg.query);

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

    // First insert "succeeds" (returns a row), second is a duplicate (no row)
    mockedPgQuery.mockResolvedValueOnce({ rows: [{ id: "row-1" }] } as never);
    mockedPgQuery.mockResolvedValueOnce({ rows: [] } as never);

    await runKevPoll();

    expect(mockedFetchKev).toHaveBeenCalledTimes(1);
    expect(mockedPgQuery).toHaveBeenCalledTimes(2);

    // Verify the SQL is the global-row INSERT we expect.
    const firstCallSql = mockedPgQuery.mock.calls[0]![0] as string;
    expect(firstCallSql).toMatch(/INSERT\s+INTO\s+cyber_signals/);
    expect(firstCallSql).toMatch(/ON\s+CONFLICT\s*\(\s*dedup_hash\s*\)\s*WHERE\s+organization_id\s+IS\s+NULL\s+DO\s+NOTHING/);

    // Verify the bound parameters include the KEV CVE IDs (positional binding
    // means we just check they appear in the params array somewhere).
    const firstParams = mockedPgQuery.mock.calls[0]![1] as unknown[];
    expect(firstParams).toContain("CVE-2026-0001");
    expect(firstParams).toContain("cisa_kev");
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

    // Single-row failure should not stop the batch — the second INSERT runs.
    await expect(runKevPoll()).resolves.toBeUndefined();
    expect(mockedPgQuery).toHaveBeenCalledTimes(2);
  });
});
