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
