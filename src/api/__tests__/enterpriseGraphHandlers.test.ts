/**
 * enterpriseGraphHandlers.test.ts — handler-level negative-path tests for the ECL
 * Slice 2 / 2b routes: enterprise_relationships CRUD + the graph resolver endpoint.
 * Proves the LIVE app-layer tenant defense (org-scoped queries + two-endpoint /
 * seed-node same-org pre-flight) at the handler layer, including the DELETE 200-JSON
 * regression (F1) and the graph seed → 404 cross-org behavior (F3).
 *
 * pg is mocked; a cross-org node/edge is modelled as the org-scoped query returning
 * rowCount 0.
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
  createEnterpriseRelationship,
  deleteEnterpriseRelationship
} from "../routes/enterpriseRelationships.js";
import { getEnterpriseGraph } from "../routes/enterpriseGraph.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
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

function baseReq(over: Partial<Request> = {}): Request {
  return {
    organizationContext: { organizationId: ORG_A },
    params: {},
    query: {},
    body: {},
    apiKey: { id: "key-1" },
    userId: "user-1",
    ip: "203.0.113.1",
    ...over
  } as unknown as Request;
}

beforeEach(() => q.mockReset());

describe("ECL relationship handlers — tenant negative paths", () => {
  it("CREATE: from-node not in org → 400 (two-endpoint pre-flight)", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // nodeInOrg(from) → not found
    const res = mockRes();
    await createEnterpriseRelationship(
      baseReq({ body: { from_type: "enterprise_entity", from_id: N1, to_type: "vendor", to_id: N2, relationship_type: "depends_on" } }),
      res
    );
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "from_node_not_in_org" });
  });

  it("CREATE: to-node not in org → 400", async () => {
    q.mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }); // from OK
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });                   // to not found
    const res = mockRes();
    await createEnterpriseRelationship(
      baseReq({ body: { from_type: "enterprise_entity", from_id: N1, to_type: "vendor", to_id: N2, relationship_type: "depends_on" } }),
      res
    );
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "to_node_not_in_org" });
  });

  it("DELETE: own edge → 200 + JSON (F1 regression)", async () => {
    q.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: N1 }] });
    const res = mockRes();
    await deleteEnterpriseRelationship(baseReq({ params: { id: N1 } as Request["params"] }), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ deleted: true, id: N1 });
  });

  it("DELETE: cross-org edge → 404", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = mockRes();
    await deleteEnterpriseRelationship(baseReq({ params: { id: N1 } as Request["params"] }), res);
    expect(res._status).toBe(404);
  });
});

describe("ECL graph handler — tenant negative paths", () => {
  it("seed node not in org → 404 (seed pre-flight), resolver never runs", async () => {
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // nodeInOrg(seed) → not found
    const res = mockRes();
    await getEnterpriseGraph(baseReq({ query: { node_type: "enterprise_entity", node_id: N1 } as Request["query"] }), res);
    expect(res._status).toBe(404);
    expect(q).toHaveBeenCalledTimes(1); // pre-flight only; resolver's 2 queries not reached
  });

  it("invalid node → 400", async () => {
    const res = mockRes();
    await getEnterpriseGraph(baseReq({ query: { node_type: "nope", node_id: N1 } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "invalid_node" });
  });

  it("depth out of range → 400", async () => {
    const res = mockRes();
    await getEnterpriseGraph(baseReq({ query: { node_type: "enterprise_entity", node_id: N1, depth: "9" } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "depth_out_of_range" });
  });

  it("missing org context → 403", async () => {
    const res = mockRes();
    await getEnterpriseGraph(baseReq({ organizationContext: undefined, query: { node_type: "enterprise_entity", node_id: N1 } as Request["query"] }), res);
    expect(res._status).toBe(403);
  });

  it("seed in org → 200 with the resolved neighbourhood", async () => {
    q.mockResolvedValueOnce({ rowCount: 1, rows: [{ "?column?": 1 }] }); // seed pre-flight OK
    q.mockResolvedValueOnce({ rowCount: 1, rows: [{ node_type: "enterprise_entity", node_id: N1, depth: 0 }] }); // nodes
    q.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // edges
    const res = mockRes();
    await getEnterpriseGraph(baseReq({ query: { node_type: "enterprise_entity", node_id: N1, depth: "2" } as Request["query"] }), res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ enterprise_graph: { root: { node_type: "enterprise_entity", node_id: N1 }, depth: 2 } });
  });
});
