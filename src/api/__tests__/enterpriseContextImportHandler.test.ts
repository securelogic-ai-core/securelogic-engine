/**
 * enterpriseContextImportHandler.test.ts — ECL Slice 3: import route handler tests.
 * pg + the file parser are mocked; drives importEnterpriseContext through its guards,
 * preview, and commit paths. Cross-org safety = the org-scoped existingKeys/insert
 * queries (org id sourced from context) + the isolation-tested tables.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));
vi.mock("../lib/enterpriseImportParser.js", () => ({
  parseImportFile: vi.fn(),
  MAX_IMPORT_ROWS: 5000
}));

import { pg } from "../infra/postgres.js";
import { parseImportFile } from "../lib/enterpriseImportParser.js";
import { importEnterpriseContext } from "../routes/enterpriseContextImport.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;
const parse = parseImportFile as unknown as ReturnType<typeof vi.fn>;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0,
    _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; },
    send() { throw new Error("send() must not be called under asTenant"); }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function req(over: Partial<Request> & { file?: unknown } = {}): Request {
  return {
    organizationContext: { organizationId: ORG_A },
    query: {},
    file: { buffer: Buffer.from("x"), originalname: "f.csv" },
    apiKey: { id: "k" },
    userId: "u",
    ip: "203.0.113.1",
    ...over
  } as unknown as Request;
}

beforeEach(() => { q.mockReset(); parse.mockReset(); });

describe("importEnterpriseContext — guards", () => {
  it("missing org context → 403", async () => {
    const res = mockRes();
    await importEnterpriseContext(req({ organizationContext: undefined } as Partial<Request>), res);
    expect(res._status).toBe(403);
  });
  it("invalid entity_type → 400", async () => {
    const res = mockRes();
    await importEnterpriseContext(req({ query: { entity_type: "business_unit" } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_entity_type" });
  });
  it("invalid mode → 400", async () => {
    const res = mockRes();
    await importEnterpriseContext(req({ query: { entity_type: "asset", mode: "delete" } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_mode" });
  });
  it("no file → 400", async () => {
    const res = mockRes();
    await importEnterpriseContext(req({ query: { entity_type: "asset" } as Request["query"], file: undefined }), res);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "no_file_uploaded" });
  });
  it("unparseable file → 400 with the parser error", async () => {
    parse.mockResolvedValueOnce({ ok: false, error: "unparseable_file" });
    const res = mockRes();
    await importEnterpriseContext(req({ query: { entity_type: "asset" } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "unparseable_file" });
  });
});

describe("importEnterpriseContext — preview", () => {
  it("returns the per-row plan without writing", async () => {
    parse.mockResolvedValueOnce({ ok: true, parsed: { headers: ["name"], rows: [{ name: "web-01" }, { name: "web-01" }], truncated: false } });
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });                    // existingKeys
    q.mockResolvedValueOnce({ rows: [{ used: "0", cap: 1000 }], rowCount: 1 }); // enforceEnterpriseEntityLimit
    const res = mockRes();
    await importEnterpriseContext(req({ query: { entity_type: "asset", mode: "preview" } as Request["query"] }), res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ mode: "preview", summary: { total: 2, ok: 1, duplicate: 1 } });
    // preview never inserts: only the 2 read queries ran.
    expect(q).toHaveBeenCalledTimes(2);
  });

  it("cap headroom limits the plan (cap - used)", async () => {
    parse.mockResolvedValueOnce({ ok: true, parsed: { headers: ["name"], rows: [{ name: "a" }, { name: "b" }], truncated: false } });
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    q.mockResolvedValueOnce({ rows: [{ used: "999", cap: 1000 }], rowCount: 1 }); // headroom 1
    const res = mockRes();
    await importEnterpriseContext(req({ query: { entity_type: "asset", mode: "preview" } as Request["query"] }), res);
    expect(res._json).toMatchObject({ summary: { ok: 1, cap_exceeded: 1 } });
  });
});

describe("importEnterpriseContext — commit", () => {
  it("persists ok rows and returns committed count", async () => {
    parse.mockResolvedValueOnce({ ok: true, parsed: { headers: ["name"], rows: [{ name: "web-01" }], truncated: false } });
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });                    // existingKeys
    q.mockResolvedValueOnce({ rows: [{ used: "0", cap: 1000 }], rowCount: 1 }); // cap
    q.mockResolvedValueOnce({ rows: [{ id: "e1" }], rowCount: 1 });        // insert enterprise_entities
    const res = mockRes();
    await importEnterpriseContext(req({ query: { entity_type: "asset", mode: "commit" } as Request["query"] }), res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ mode: "commit", committed: 1, summary: { ok: 1 } });
  });
});
