/**
 * assetLifecycleHandlers.test.ts — EAR P6: the update validator + the
 * PATCH/DELETE /api/assets/:id handlers (pg mocked). Proves the partial-update
 * vocabulary, the detail-backed-only refusal (EAR-AD-1: per-type routes stay
 * authoritative for the rest), and org-parameterization. Real-Postgres
 * round-trips are covered by test/isolation/assetLifecycle.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));

import { pg } from "../infra/postgres.js";
import { validateAssetDetailUpdate } from "../lib/assetDetailValidation.js";
import { updateAsset, deleteAsset } from "../routes/assets.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REG_ID = "11111111-1111-4111-8111-111111111111";
const BACKING_ID = "22222222-2222-4222-8222-222222222222";
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

function reqFor(orgId: string | null, id: string, body: unknown = undefined): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    params: { id },
    body,
    ip: "203.0.113.5"
  } as unknown as Request;
}

beforeEach(() => q.mockReset());

describe("validateAssetDetailUpdate", () => {
  it("accepts a partial patch and normalizes it", () => {
    const r = validateAssetDetailUpdate("endpoint", { name: "  laptop-9  ", exposure: "internal" });
    expect(r).toEqual({ input: { patch: { name: "laptop-9", exposure: "internal" } } });
  });

  it("null clears nullable fields; required typed fields cannot be cleared", () => {
    expect(validateAssetDetailUpdate("endpoint", { criticality: null, os: null })).toEqual({
      input: { patch: { criticality: null, os: null } }
    });
    expect(validateAssetDetailUpdate("cloud_resource", { provider: null })).toMatchObject({
      error: "provider_required"
    });
  });

  it("rejects unknown vocabulary values and empty patches", () => {
    expect(validateAssetDetailUpdate("api", { protocol: "carrier_pigeon" })).toMatchObject({
      error: "protocol_invalid"
    });
    expect(validateAssetDetailUpdate("endpoint", {})).toMatchObject({ error: "empty_update" });
    expect(validateAssetDetailUpdate("endpoint", { unrelated_key: "x" })).toMatchObject({ error: "empty_update" });
    expect(validateAssetDetailUpdate("endpoint", { status: "sideways" })).toMatchObject({ error: "status_invalid" });
  });
});

describe("PATCH/DELETE /api/assets/:id", () => {
  it("403 without org context; 400 on a non-uuid id", async () => {
    for (const handler of [updateAsset, deleteAsset]) {
      const noOrg = mockRes();
      await handler(reqFor(null, REG_ID, {}), noOrg);
      expect(noOrg._status).toBe(403);

      const badId = mockRes();
      await handler(reqFor(ORG_A, "not-a-uuid", { name: "x" }), badId);
      expect(badId._status).toBe(400);
    }
    expect(q).not.toHaveBeenCalled();
  });

  it("409 not_detail_backed for vendor/ai_system/entity-backed assets (EAR-AD-1)", async () => {
    for (const backing of ["vendors", "ai_systems", "enterprise_entities"]) {
      q.mockResolvedValueOnce({
        rows: [{ id: REG_ID, backing_kind: backing, backing_id: BACKING_ID }],
        rowCount: 1
      });
      const res = mockRes();
      await updateAsset(reqFor(ORG_A, REG_ID, { name: "x" }), res);
      expect(res._status, backing).toBe(409);
      expect(res._json).toMatchObject({ error: "not_detail_backed" });
    }
  });

  it("PATCH: resolves, validates against the resolved type, updates org-scoped", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: REG_ID, backing_kind: "endpoints", backing_id: BACKING_ID }],
      rowCount: 1
    });
    // no name/external_ref in patch → no clash pre-checks; straight to UPDATE
    q.mockResolvedValueOnce({
      rows: [{ id: BACKING_ID, exposure: "internet_facing" }],
      rowCount: 1
    });
    const res = mockRes();
    await updateAsset(reqFor(ORG_A, REG_ID, { exposure: "internet_facing" }), res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ asset: { exposure: "internet_facing", asset_id: REG_ID } });

    const resolveCall = q.mock.calls[0]!;
    expect(resolveCall[1]).toEqual([REG_ID, ORG_A]);
    const updateCall = q.mock.calls[1]!;
    expect(updateCall[0]).toContain("UPDATE endpoints");
    expect(updateCall[0]).toContain("updated_at = now()");
    expect(updateCall[1]).toEqual([BACKING_ID, ORG_A, "internet_facing"]);
  });

  it("PATCH: 400 from the resolved type's vocabulary (endpoint has no 'protocol')", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: REG_ID, backing_kind: "endpoints", backing_id: BACKING_ID }],
      rowCount: 1
    });
    const res = mockRes();
    await updateAsset(reqFor(ORG_A, REG_ID, { protocol: "rest" }), res);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: "empty_update" });
  });

  it("DELETE: removes the detail row then the registry row; 404 when gone", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: REG_ID, backing_kind: "apis", backing_id: BACKING_ID }],
      rowCount: 1
    });
    // SL-OCC-1: the exposure guard runs before the delete. Zero occurrences here.
    q.mockResolvedValueOnce({ rows: [{ n: "0" }], rowCount: 1 });
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE FROM apis
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // deregister (DELETE FROM assets)
    const res = mockRes();
    await deleteAsset(reqFor(ORG_A, REG_ID), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ deleted: true });
    // Asserted by CONTENT rather than call index: a new pre-flight query should
    // not break a test about which deletes ran, and the previous index-based
    // form broke for exactly that reason.
    const sql = q.mock.calls.map((c) => String(c[0]));
    expect(sql.some((t) => t.includes("DELETE FROM apis"))).toBe(true);
    expect(sql.some((t) => t.includes("DELETE FROM assets"))).toBe(true);
    expect(sql.findIndex((t) => t.includes("DELETE FROM apis")))
      .toBeLessThan(sql.findIndex((t) => t.includes("DELETE FROM assets")));

    q.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // resolve: no registry row
    const missing = mockRes();
    await deleteAsset(reqFor(ORG_A, REG_ID), missing);
    expect(missing._status).toBe(404);
  });

  it("DELETE: 409 rather than erasing recorded vulnerability exposure", async () => {
    // finding_asset_occurrences.asset_id is ON DELETE RESTRICT, so without this
    // guard the delete would surface as an unhandled 500. The count is returned
    // so the caller can see what is in the way.
    q.mockResolvedValueOnce({
      rows: [{ id: REG_ID, backing_kind: "apis", backing_id: BACKING_ID }],
      rowCount: 1
    });
    q.mockResolvedValueOnce({ rows: [{ n: "17" }], rowCount: 1 });
    const res = mockRes();
    await deleteAsset(reqFor(ORG_A, REG_ID), res);
    expect(res._status).toBe(409);
    expect(res._json).toMatchObject({
      error: "asset_has_vulnerability_occurrences",
      occurrence_count: 17
    });
    // Nothing was deleted.
    const sql = q.mock.calls.map((c) => String(c[0]));
    expect(sql.some((t) => t.includes("DELETE FROM"))).toBe(false);
  });
});
