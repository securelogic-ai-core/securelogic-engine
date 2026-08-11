/**
 * enterpriseEntitiesHandlers.test.ts — handler-level negative-path tests for the ECL
 * Slice 1 routes (the LIVE app-layer tenant defense: `WHERE organization_id = $org`
 * sourced from req.organizationContext). The isolation tests prove the (inert) RLS
 * layer; these prove the handlers themselves 404 on cross-org access and return valid
 * JSON — including the DELETE path (regression for the asTenant `send()` defect, F1).
 *
 * pg is mocked so a cross-org read/delete is modelled as rowCount 0 (exactly what the
 * org-scoped query returns for another org's row).
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
import {
  getEnterpriseEntity,
  listEnterpriseEntities,
  updateEnterpriseEntity,
  deleteEnterpriseEntity
} from "../routes/enterpriseEntities.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "11111111-1111-4111-8111-111111111111";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0,
    _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; },
    send() { throw new Error("send() must not be called under asTenant"); }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function reqFor(id: string, orgId: string | null = ORG_A, body: unknown = {}): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    params: { id },
    query: {},
    body,
    apiKey: { id: "key-1" },
    userId: "user-1",
    ip: "203.0.113.1"
  } as unknown as Request;
}

beforeEach(() => q.mockReset());

describe("ECL Slice 1 handlers — tenant negative paths", () => {
  it("GET one: cross-org id (org-scoped query returns nothing) → 404", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = mockRes();
    await getEnterpriseEntity(reqFor(ID), res);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: "not_found" });
  });

  it("GET one: missing org context → 403", async () => {
    const res = mockRes();
    await getEnterpriseEntity(reqFor(ID, null), res);
    expect(res._status).toBe(403);
    expect(res._json).toEqual({ error: "organization_context_missing" });
  });

  it("GET one: invalid id → 400", async () => {
    const res = mockRes();
    await getEnterpriseEntity(reqFor("not-a-uuid"), res);
    expect(res._status).toBe(400);
  });

  it("UPDATE: cross-org id → 404 (target load is org-scoped)", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // SELECT id, entity_type ... WHERE org
    const res = mockRes();
    await updateEnterpriseEntity(reqFor(ID, ORG_A, { name: "x" }), res);
    expect(res._status).toBe(404);
  });

  it("DELETE: own row → 200 + JSON (NOT 204/send — F1 regression)", async () => {
    q.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: ID }] });
    const res = mockRes();
    await deleteEnterpriseEntity(reqFor(ID), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ deleted: true, id: ID });
  });

  it("DELETE: cross-org id (org-scoped delete affects 0 rows) → 404", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = mockRes();
    await deleteEnterpriseEntity(reqFor(ID), res);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: "not_found" });
  });

  it("LIST: passes the org id from context into the query", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = mockRes();
    await listEnterpriseEntities(reqFor(ID), res);
    expect(res._status).toBe(200);
    // First bind param is the org id from req.organizationContext (never the body).
    expect(q.mock.calls[0][1][0]).toBe(ORG_A);
  });
});

// ── q search — the shared asset-search capability, narrowed to this list's
//    own rows by backing id (enterprise_entities-backed assets only). ────────

function reqWithQuery(query: Record<string, unknown>, orgId: string | null = ORG_A): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    params: {},
    query,
    body: {},
    apiKey: { id: "key-1" },
    userId: "user-1",
    ip: "203.0.113.1"
  } as unknown as Request;
}

describe("listEnterpriseEntities — the q search", () => {
  it("resolves via the SHARED search index, then filters by entity (backing) id", async () => {
    // 1st query: the resolver; 2nd: the org-scoped list narrowed to backing ids.
    q.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        { asset_id: "as-1", asset_type: "application", backing_kind: "enterprise_entities", backing_id: "e-1", term_kind: "name" },
        // A vendor match must NOT leak into an entities list — wrong backing kind.
        { asset_id: "as-2", asset_type: "vendor", backing_kind: "vendors", backing_id: "v-1", term_kind: "alias" }
      ]
    });
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = mockRes();
    await listEnterpriseEntities(reqWithQuery({ q: "billing" }), res);

    expect(res._status).toBe(200);
    const [resolverSql, resolverParams] = q.mock.calls[0] as [string, unknown[]];
    expect(resolverSql).toContain("FROM asset_search_index_v");
    expect(resolverParams[0]).toBe(ORG_A);
    expect(resolverParams[1]).toBe("%billing%");

    const [listSql, listParams] = q.mock.calls[1] as [string, unknown[]];
    expect(listSql).toContain("id = ANY($5::uuid[])");
    expect(listParams).toEqual([ORG_A, null, 25, 0, ["e-1"]]);
  });

  it("no entity-backed matches → honest empty envelope, no list query", async () => {
    q.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ asset_id: "as-2", asset_type: "vendor", backing_kind: "vendors", backing_id: "v-1", term_kind: "name" }]
    });

    const res = mockRes();
    await listEnterpriseEntities(reqWithQuery({ q: "acme" }), res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ enterprise_entities: [], limit: 25, offset: 0 });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("blank q is a no-op; out-of-bounds q is 400 invalid_search (platform 2–120)", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const okRes = mockRes();
    await listEnterpriseEntities(reqWithQuery({ q: "  " }), okRes);
    expect(okRes._status).toBe(200);
    expect((q.mock.calls[0] as [string, unknown[]])[0]).not.toContain("asset_search_index_v");

    q.mockReset();
    for (const bad of ["a", "a".repeat(121), ["a", "b"]]) {
      const res = mockRes();
      await listEnterpriseEntities(reqWithQuery({ q: bad }), res);
      expect(res._status, JSON.stringify(bad).slice(0, 20)).toBe(400);
      expect(res._json).toEqual({ error: "invalid_search" });
    }
    expect(q).not.toHaveBeenCalled();
  });

  it("q composes with the entity_type filter (both applied to the list query)", async () => {
    q.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ asset_id: "as-1", asset_type: "application", backing_kind: "enterprise_entities", backing_id: "e-1", term_kind: "name" }]
    });
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = mockRes();
    await listEnterpriseEntities(reqWithQuery({ q: "billing", entity_type: "application" }), res);

    expect(res._status).toBe(200);
    expect((q.mock.calls[1] as [string, unknown[]])[1]).toEqual([ORG_A, "application", 25, 0, ["e-1"]]);
  });
});
