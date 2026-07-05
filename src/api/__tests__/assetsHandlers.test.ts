/**
 * assetsHandlers.test.ts — EAR Phase 0: handler-level unit tests for
 * GET /api/assets (pg mocked). Proves the tenant guard, pagination and
 * asset_type validation, org-parameterization of both queries, and the
 * response envelope. Real-Postgres rows are covered by
 * test/isolation/assetRegistryView.test.ts.
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
import { listAssets } from "../routes/assets.js";

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

function reqFor(orgId: string | null = ORG_A, query: Record<string, unknown> = {}): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    query
  } as unknown as Request;
}

beforeEach(() => q.mockReset());

describe("listAssets", () => {
  it("403 without org context (no query runs)", async () => {
    const res = mockRes();
    await listAssets(reqFor(null), res);
    expect(res._status).toBe(403);
    expect(res._json).toMatchObject({ error: "organization_context_missing" });
    expect(q).not.toHaveBeenCalled();
  });

  it("400 on invalid pagination", async () => {
    for (const query of [{ limit: "abc" }, { limit: "-1" }, { limit: "101" }, { offset: "1.5" }]) {
      const res = mockRes();
      await listAssets(reqFor(ORG_A, query), res);
      expect(res._status, JSON.stringify(query)).toBe(400);
      expect(res._json).toMatchObject({ error: "invalid_pagination" });
    }
    expect(q).not.toHaveBeenCalled();
  });

  it("400 on unknown asset_type (entity_type vocabulary is rejected)", async () => {
    const res = mockRes();
    await listAssets(reqFor(ORG_A, { asset_type: "data_store" }), res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_asset_type" });
    expect(q).not.toHaveBeenCalled();
  });

  it("lists assets: both queries org-scoped against the view; envelope carries total/limit/offset", async () => {
    const row = {
      asset_id: "id-1", asset_type: "vendor", organization_id: ORG_A, name: "Acme",
      criticality: "high", owner_user_id: null, status: "active",
      backing_kind: "vendors", backing_id: "id-1", lifecycle_status: null,
      created_at: "2026-07-01", updated_at: "2026-07-01"
    };
    q.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    q.mockResolvedValueOnce({ rows: [{ n: 1 }], rowCount: 1 });

    const res = mockRes();
    await listAssets(reqFor(), res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ assets: [row], total: 1, limit: 25, offset: 0 });

    expect(q).toHaveBeenCalledTimes(2);
    for (const [sql, params] of q.mock.calls as Array<[string, unknown[]]>) {
      expect(sql).toContain("FROM asset_registry_v");
      expect(sql).toContain("organization_id = $1");
      expect(params[0]).toBe(ORG_A);
    }
    // No type filter → $2 NULL.
    expect((q.mock.calls[0] as [string, unknown[]])[1][1]).toBeNull();
  });

  it("applies a valid asset_type filter to both queries", async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    q.mockResolvedValueOnce({ rows: [{ n: 0 }], rowCount: 1 });

    const res = mockRes();
    await listAssets(reqFor(ORG_A, { asset_type: "database", limit: "5", offset: "10" }), res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ assets: [], total: 0, limit: 5, offset: 10 });
    expect((q.mock.calls[0] as [string, unknown[]])[1]).toEqual([ORG_A, "database", 5, 10]);
    expect((q.mock.calls[1] as [string, unknown[]])[1]).toEqual([ORG_A, "database"]);
  });
});
