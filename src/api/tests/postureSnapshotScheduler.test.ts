import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  state: {
    orgs: [] as Array<{ id: string }>,
    tenantScopes: [] as string[],
  },
  compute: vi.fn(async (_orgId: string) => ({}) as unknown),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  pgElevated: {
    query: vi.fn(async (sql: string) => {
      if (/FROM organizations/.test(sql)) {
        return { rows: h.state.orgs, rowCount: h.state.orgs.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  },
  withTenant: vi.fn(async (orgId: string, cb: () => Promise<unknown>) => {
    h.state.tenantScopes.push(orgId);
    return cb();
  }),
}));
vi.mock("../lib/postureSnapshot.js", () => ({
  computeAndSavePostureSnapshot: (orgId: string) => h.compute(orgId),
}));

import { runDailyPostureSnapshots } from "../lib/postureSnapshotScheduler.js";

beforeEach(() => {
  h.state.orgs = [];
  h.state.tenantScopes = [];
  h.compute.mockClear();
  h.compute.mockResolvedValue({});
});

describe("runDailyPostureSnapshots", () => {
  it("snapshots every active org inside its own tenant scope", async () => {
    h.state.orgs = [{ id: ORG_A }, { id: ORG_B }];

    const out = await runDailyPostureSnapshots();

    expect(out).toEqual({ orgsProcessed: 2, snapshotsWritten: 2, failures: 0 });
    // Each compute runs INSIDE withTenant for its own org — RLS-correct and
    // provably single-org.
    expect(h.state.tenantScopes).toEqual([ORG_A, ORG_B]);
    expect(h.compute).toHaveBeenNthCalledWith(1, ORG_A);
    expect(h.compute).toHaveBeenNthCalledWith(2, ORG_B);
  });

  it("one org's failure never freezes another org's history", async () => {
    h.state.orgs = [{ id: ORG_A }, { id: ORG_B }];
    h.compute
      .mockRejectedValueOnce(new Error("tenant A boom"))
      .mockResolvedValueOnce({});

    const out = await runDailyPostureSnapshots();

    expect(out).toEqual({ orgsProcessed: 2, snapshotsWritten: 1, failures: 1 });
    expect(h.compute).toHaveBeenCalledTimes(2);
  });

  it("a quiet platform is a clean no-op", async () => {
    const out = await runDailyPostureSnapshots();
    expect(out).toEqual({ orgsProcessed: 0, snapshotsWritten: 0, failures: 0 });
    expect(h.compute).not.toHaveBeenCalled();
  });
});
