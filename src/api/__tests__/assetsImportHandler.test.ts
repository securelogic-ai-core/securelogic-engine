/**
 * assetsImportHandler.test.ts — EAR P16: the detail-backed asset import route
 * handler. pg + the file parser are mocked; drives importAssets through its
 * guards and the preview path. Cross-org safety = the org-scoped existingKeys /
 * cap-count queries (org id sourced from context only), mirroring the ECL
 * importer's handler test.
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
import { importAssets } from "../routes/assets.js";

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

describe("importAssets — guards", () => {
  it("missing org context → 403", async () => {
    const res = mockRes();
    await importAssets(req({ organizationContext: undefined } as Partial<Request>), res);
    expect(res._status).toBe(403);
  });
  it("non-detail-backed asset_type → 400 invalid_asset_type", async () => {
    const res = mockRes();
    await importAssets(req({ query: { asset_type: "vendor" } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_asset_type" });
  });
  it("invalid mode → 400", async () => {
    const res = mockRes();
    await importAssets(req({ query: { asset_type: "endpoint", mode: "delete" } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "invalid_mode" });
  });
  it("no file → 400", async () => {
    const res = mockRes();
    await importAssets(req({ query: { asset_type: "endpoint" } as Request["query"], file: undefined }), res);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "no_file_uploaded" });
  });
  it("unparseable file → 400 with the parser error", async () => {
    parse.mockResolvedValueOnce({ ok: false, error: "unparseable_file" });
    const res = mockRes();
    await importAssets(req({ query: { asset_type: "endpoint" } as Request["query"] }), res);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ error: "unparseable_file" });
  });
});

describe("importAssets — preview", () => {
  it("returns the per-row plan without writing (dedup + typed validation)", async () => {
    parse.mockResolvedValueOnce({
      ok: true,
      parsed: {
        headers: ["name", "provider"],
        rows: [
          { name: "prod-bucket", provider: "aws" },
          { name: "Prod-Bucket", provider: "aws" }, // duplicate_in_file (case-insensitive)
          { name: "no-provider" } // invalid — provider required
        ],
        truncated: false
      }
    });
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });                 // assetImportExistingKeys
    q.mockResolvedValueOnce({ rows: [{ n: 0 }], rowCount: 1 });         // assetImportCapHeadroom count
    const res = mockRes();
    await importAssets(req({ query: { asset_type: "cloud_resource", mode: "preview" } as Request["query"] }), res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ mode: "preview", summary: { total: 3, ok: 1, invalid: 1, duplicate: 1 } });
    // preview never inserts: only the 2 read queries ran.
    expect(q).toHaveBeenCalledTimes(2);
  });

  it("cap headroom limits the plan (DETAIL_ASSET_CAP - used)", async () => {
    parse.mockResolvedValueOnce({
      ok: true,
      parsed: { headers: ["name", "provider"], rows: [{ name: "a", provider: "aws" }, { name: "b", provider: "aws" }], truncated: false }
    });
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });                 // existingKeys
    q.mockResolvedValueOnce({ rows: [{ n: 9999 }], rowCount: 1 });      // used 9999 of 10000 → headroom 1
    const res = mockRes();
    await importAssets(req({ query: { asset_type: "cloud_resource", mode: "preview" } as Request["query"] }), res);
    expect(res._json).toMatchObject({ summary: { ok: 1, cap_exceeded: 1 } });
  });
});
