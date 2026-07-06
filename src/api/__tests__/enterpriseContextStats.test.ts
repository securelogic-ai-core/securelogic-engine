/**
 * enterpriseContextStats.test.ts — R6: handler-level unit tests for the ECL
 * stats/rollup endpoint (pg mocked). Proves the tenant guard, that every
 * aggregate query is org-parameterized, the current-only applicability CTE
 * shape, and the response rollup assembly. Real-Postgres numbers are covered
 * by test/isolation/enterpriseContextStats.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import { getEnterpriseContextStats } from "../routes/enterpriseContextStats.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0,
    _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(orgId: string | null = ORG_A): Request {
  return { organizationContext: orgId ? { organizationId: orgId } : undefined } as unknown as Request;
}

beforeEach(() => q.mockReset());

describe("getEnterpriseContextStats", () => {
  it("403 without org context (no query runs)", async () => {
    const res = mockRes();
    await getEnterpriseContextStats(reqFor(null), res);
    expect(res._status).toBe(403);
    expect(q).not.toHaveBeenCalled();
  });

  it("assembles the rollup from the four org-scoped aggregates", async () => {
    q.mockResolvedValueOnce({
      rows: [
        { entity_type: "application", criticality: "high", n: 3 },
        { entity_type: "application", criticality: null, n: 1 },
        { entity_type: "data_store", criticality: "critical", n: 2 }
      ],
      rowCount: 3
    });
    q.mockResolvedValueOnce({ rows: [{ n: 7 }], rowCount: 1 });
    q.mockResolvedValueOnce({
      rows: [{
        current_total: 4,
        affected: 2,
        potentially_affected: 1,
        needs_review: 1,
        not_affected: 0,
        unknown: 0,
        affected_high_confidence: 1,
        total_assessments: 9,
        blast_radius_nodes: 5
      }],
      rowCount: 1
    });
    q.mockResolvedValueOnce({
      rows: [{ pending_suggestions: 3, open_findings: 2, open_actions: 4 }],
      rowCount: 1
    });

    const res = mockRes();
    await getEnterpriseContextStats(reqFor(), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      stats: {
        entities: {
          total: 6,
          by_type: { application: 4, data_store: 2 },
          by_criticality: { high: 3, critical: 2 }
        },
        relationships: { total: 7 },
        applicability: {
          current_total: 4,
          by_decision: { affected: 2, potentially_affected: 1, needs_review: 1, not_affected: 0, unknown: 0 },
          affected_high_confidence: 1,
          total_assessments: 9,
          blast_radius_nodes: 5
        },
        workflow: { pending_suggestions: 3, open_findings: 2, open_actions: 4 }
      }
    });

    // Every aggregate is org-parameterized; the applicability rollup is
    // current-only (DISTINCT ON ... seq DESC).
    expect(q).toHaveBeenCalledTimes(4);
    for (const call of q.mock.calls) {
      expect(call[1]).toEqual([ORG_A]);
    }
    const applicabilitySql = q.mock.calls[2][0] as string;
    expect(applicabilitySql).toContain("DISTINCT ON (signal_id, target_type, target_id)");
    expect(applicabilitySql).toContain("seq DESC");
    const edgeSql = q.mock.calls[1][0] as string;
    expect(edgeSql).toContain("deleted_at IS NULL");
  });

  it("EAR Phase 5: no assets key and no fifth query while the registry flag is off", async () => {
    for (let i = 0; i < 4; i++) q.mockResolvedValueOnce({ rows: i === 0 ? [] : [{}], rowCount: 1 });
    const res = mockRes();
    await getEnterpriseContextStats(reqFor(), res);
    expect(res._status).toBe(200);
    expect((res._json as { stats: Record<string, unknown> }).stats).not.toHaveProperty("assets");
    expect(q).toHaveBeenCalledTimes(4);
  });

  it("EAR Phase 5: registry flag on → org-scoped asset_registry_v rollup in stats.assets", async () => {
    const prev = process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED;
    process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED = "true";
    try {
      for (let i = 0; i < 4; i++) q.mockResolvedValueOnce({ rows: i === 0 ? [] : [{}], rowCount: 1 });
      q.mockResolvedValueOnce({
        rows: [
          { asset_type: "vendor", criticality: "high", n: 3 },
          { asset_type: "endpoint", criticality: null, n: 5 },
          { asset_type: "endpoint", criticality: "critical", n: 1 }
        ],
        rowCount: 3
      });
      const res = mockRes();
      await getEnterpriseContextStats(reqFor(), res);
      expect(res._status).toBe(200);
      expect((res._json as { stats: { assets: unknown } }).stats.assets).toEqual({
        total: 9,
        by_type: { vendor: 3, endpoint: 6 },
        by_criticality: { high: 3, critical: 1 }
      });
      expect(q).toHaveBeenCalledTimes(5);
      const registrySql = q.mock.calls[4][0] as string;
      expect(registrySql).toContain("asset_registry_v");
      expect(q.mock.calls[4][1]).toEqual([ORG_A]);
    } finally {
      if (prev === undefined) delete process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED;
      else process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED = prev;
    }
  });
});
