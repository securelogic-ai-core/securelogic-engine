/**
 * vendorExtractionWorkerClaimGate.test.ts — Part 2 Phase 2A claim-path flag gate.
 *
 * The web ENQUEUE flag (SECURELOGIC_VENDOR_ASSURANCE_ENABLED) gates only the
 * upload route; the worker's claim path was flag-blind and safe only while the
 * prod jobs table stayed empty. `runOneTick` now refuses to claim when the
 * feature is disabled in THIS service's environment, independent of queue
 * contents (idle-skip, returns 0, never throws).
 *
 * DB-free, mirroring vendorQueueDepthAlert.test.ts: postgres.js eager-creates a
 * Pool and throws at module-eval without DATABASE_URL, and the gate short-
 * circuits before any claim, so we mock the channel purely so the worker module
 * imports cleanly, then assert only on the mocked claim query (pgElevated.query).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { claimQuery } = vi.hoisted(() => ({ claimQuery: vi.fn() }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: claimQuery },
  withTenant: (_org: string, fn: () => unknown) => fn(),
}));

import { runOneTick } from "../workers/vendorExtractionWorker.js";

const ENV = process.env;

beforeEach(() => {
  claimQuery.mockReset();
  process.env = { ...ENV };
});

afterEach(() => {
  process.env = ENV;
});

describe("vendor-extraction worker — claim-path flag gate (runOneTick)", () => {
  it("flag OFF → refuses to claim even with a claimable row available", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED; // → disabled

    // Prime the claim to RETURN a claimable job: if the gate were absent the
    // worker would claim it. The gate must fire first, so the query is never run.
    claimQuery.mockResolvedValue({
      rows: [
        {
          id: "job-1",
          organization_id: "org-1",
          requested_by_user_id: null,
          job_type: "vendor_assurance_extract",
          status: "processing",
          attempts: 1,
          max_attempts: 5,
          payload: { documentId: "doc-1" },
        },
      ],
    });

    const processed = await runOneTick({ workerId: "test" });

    expect(processed).toBe(0);
    expect(claimQuery).not.toHaveBeenCalled(); // no claim query issued
  });

  it("flag ON → claims normally (gate open, claim query issued once)", async () => {
    process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true"; // → enabled
    claimQuery.mockResolvedValue({ rows: [] }); // empty → loop ends after one claim, no processing

    const processed = await runOneTick({ workerId: "test" });

    expect(claimQuery).toHaveBeenCalledTimes(1); // the claim path ran
    expect(processed).toBe(0);
  });
});
