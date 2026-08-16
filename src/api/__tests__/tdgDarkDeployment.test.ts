/**
 * tdgDarkDeployment.test.ts — proof that E-1 deploys to production COMPLETELY
 * INERT, not merely "off in the UI".
 *
 * The route gates are covered by tdgRoutesAreDark.test.ts. This file covers the
 * two paths a 404 cannot speak for, because they have no HTTP surface at all:
 * the cron enqueuer that would create the work, and the worker claim filter
 * that would pick it up. Both must do NOTHING while the flag is off — and
 * "nothing" has to mean no database access, not "a query that happens to return
 * no rows", because a dark feature that still queries production every tick is
 * a dark feature with a production footprint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockElevatedQuery } = vi.hoisted(() => ({ mockElevatedQuery: vi.fn() }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: mockElevatedQuery },
  pgElevated: { query: mockElevatedQuery },
  withTenant: (_org: string, fn: () => unknown) => fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { enqueueRetentionSweeps } from "../lib/governance/retentionSweepEnqueuer.js";
import { claimedJobTypes } from "../lib/accountDeletionReaperPolicy.js";
import {
  tenantDataGovernanceEnabled,
  RETENTION_SWEEP_JOB_TYPE,
  activationBlockers,
} from "../lib/governance/tdgPolicy.js";

const FLAG = "SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED";
const FROM = "SECURELOGIC_TDG_EFFECTIVE_FROM";

let savedFlag: string | undefined;
let savedFrom: string | undefined;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  savedFrom = process.env[FROM];
  delete process.env[FLAG];
  delete process.env[FROM];
  mockElevatedQuery.mockReset();
  mockElevatedQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  if (savedFrom === undefined) delete process.env[FROM];
  else process.env[FROM] = savedFrom;
});

describe("the enqueuer is inert while the flag is off", () => {
  it("returns 0 and issues ZERO queries — a dark feature has no production footprint", async () => {
    const created = await enqueueRetentionSweeps();
    expect(created).toBe(0);
    expect(mockElevatedQuery).not.toHaveBeenCalled();
  });

  it("stays inert when the flag is any value other than exactly 'true'", async () => {
    for (const value of ["false", "TRUE", "1", "yes", ""]) {
      process.env[FLAG] = value;
      mockElevatedQuery.mockClear();
      expect(await enqueueRetentionSweeps()).toBe(0);
      expect(mockElevatedQuery, `flag='${value}' must not query`).not.toHaveBeenCalled();
    }
  });

  it("only once the flag is on does it touch the database at all", async () => {
    process.env[FLAG] = "true";
    await enqueueRetentionSweeps();
    expect(mockElevatedQuery).toHaveBeenCalled();
  });
});

describe("the worker cannot claim a sweep while the flag is off", () => {
  // Mirrors the composition in dataRightsWorker.claimNextJob.
  function claimTypes(): string[] {
    const types = [...claimedJobTypes(false)];
    if (tenantDataGovernanceEnabled()) types.push(RETENTION_SWEEP_JOB_TYPE);
    return types;
  }

  it("the claim filter excludes retention_sweep when dark", () => {
    expect(claimTypes()).not.toContain(RETENTION_SWEEP_JOB_TYPE);
  });

  it("and includes it only when the flag is on", () => {
    process.env[FLAG] = "true";
    expect(claimTypes()).toContain(RETENTION_SWEEP_JOB_TYPE);
  });

  it("the worker source composes exactly that, so this test is not a fiction", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/api/workers/dataRightsWorker.ts"), "utf8");
    expect(src).toMatch(/if \(tenantDataGovernanceEnabled\(\)\) jobTypes\.push\(RETENTION_SWEEP_JOB_TYPE\)/);
  });
});

describe("the second gate holds even when the first one is opened", () => {
  it("flag on + effective-from unset still blocks every deletion", () => {
    process.env[FLAG] = "true";
    expect(activationBlockers(process.env, new Date())).toEqual(["effective_from_unset"]);
  });

  it("production's declared state — both gates closed — reports both blockers", () => {
    // render.yaml declares ENABLED "false" and EFFECTIVE_FROM "". Absent behaves
    // identically, which is what the unsynced Blueprint actually produces.
    process.env[FLAG] = "false";
    process.env[FROM] = "";
    expect(activationBlockers(process.env, new Date())).toEqual([
      "flag_disabled",
      "effective_from_unset",
    ]);
  });
});
