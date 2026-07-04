/**
 * enterpriseEdgeLimit.test.ts — Item 9 (H1). enforceEnterpriseEdgeLimit with pg mocked.
 * Database-free. (Real end-to-end enforcement is covered in the isolation test.)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import { enforceEnterpriseEdgeLimit } from "../lib/enterpriseEdgeLimit.js";

const q = pg.query as unknown as ReturnType<typeof vi.fn>;

describe("enforceEnterpriseEdgeLimit", () => {
  beforeEach(() => q.mockReset());

  it("not exceeded when used < cap", async () => {
    q.mockResolvedValueOnce({ rows: [{ used: "10", cap: 50000 }], rowCount: 1 });
    expect(await enforceEnterpriseEdgeLimit("org-1")).toEqual({ exceeded: false, used: 10, cap: 50000 });
  });

  it("exceeded when used === cap (>= is the block condition)", async () => {
    q.mockResolvedValueOnce({ rows: [{ used: "50000", cap: 50000 }], rowCount: 1 });
    expect((await enforceEnterpriseEdgeLimit("org-1")).exceeded).toBe(true);
  });

  it("exceeded when used > cap (grandfathered over-cap org)", async () => {
    q.mockResolvedValueOnce({ rows: [{ used: "60000", cap: 50000 }], rowCount: 1 });
    expect((await enforceEnterpriseEdgeLimit("org-1")).exceeded).toBe(true);
  });

  it("falls back to the 50000 default cap when the row/cap is absent", async () => {
    q.mockResolvedValueOnce({ rows: [{ used: "3", cap: null }], rowCount: 1 });
    expect(await enforceEnterpriseEdgeLimit("org-1")).toEqual({ exceeded: false, used: 3, cap: 50000 });
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await enforceEnterpriseEdgeLimit("org-1")).toEqual({ exceeded: false, used: 0, cap: 50000 });
  });
});
