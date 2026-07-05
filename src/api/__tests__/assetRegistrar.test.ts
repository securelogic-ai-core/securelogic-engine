/**
 * assetRegistrar.test.ts — EAR Phase 1: unit tests for the registry-row
 * lifecycle helpers (pg mocked) + the migration↔helper backfill lockstep.
 * Real-Postgres behavior (backfill coverage, RLS, view repoint) is covered by
 * test/isolation/assetsSpine.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import { registerAsset, deregisterAsset, backfillAssetRegistry, isBackingKind } from "../lib/assetRegistrar.js";
import { ENTITY_TYPE_TO_ASSET_TYPE } from "../lib/assetRegistry.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const q = pg.query as unknown as ReturnType<typeof vi.fn>;

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../db/migrations/20260803_assets_spine.sql"
);

beforeEach(() => q.mockReset());

describe("registerAsset", () => {
  it("upserts the registry row and points the backing row at it (org-scoped, idempotent shape)", async () => {
    q.mockResolvedValueOnce({ rows: [{ id: ASSET }], rowCount: 1 });
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const id = await registerAsset(ORG_A, "vendor", "vendors", ROW);
    expect(id).toBe(ASSET);

    const [insSql, insParams] = q.mock.calls[0] as [string, unknown[]];
    expect(insSql).toContain("INSERT INTO assets");
    expect(insSql).toContain("ON CONFLICT (organization_id, backing_kind, backing_id)");
    expect(insParams).toEqual([ORG_A, "vendor", "vendors", ROW]);

    const [updSql, updParams] = q.mock.calls[1] as [string, unknown[]];
    expect(updSql).toContain("UPDATE vendors SET asset_id");
    expect(updSql).toContain("organization_id = $3");
    expect(updParams).toEqual([ASSET, ROW, ORG_A]);
  });

  it("dispatches the back-pointer UPDATE to the right backing table", async () => {
    q.mockResolvedValue({ rows: [{ id: ASSET }], rowCount: 1 });
    await registerAsset(ORG_A, "database", "enterprise_entities", ROW);
    expect((q.mock.calls[1] as [string])[0]).toContain("UPDATE enterprise_entities SET asset_id");
  });

  it("rejects unknown backing kinds without touching the DB", async () => {
    await expect(
      registerAsset(ORG_A, "vendor", "signals" as never, ROW)
    ).rejects.toThrow(/unknown backing kind/);
    expect(q).not.toHaveBeenCalled();
    expect(isBackingKind("vendors")).toBe(true);
    expect(isBackingKind("signals")).toBe(false);
  });
});

describe("deregisterAsset", () => {
  it("deletes the registry row org-scoped by (backing_kind, backing_id)", async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await deregisterAsset(ORG_A, "ai_systems", ROW);
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("DELETE FROM assets");
    expect(params).toEqual([ORG_A, "ai_systems", ROW]);
  });
});

describe("backfill ↔ 20260803 migration lockstep", () => {
  it("helper statements match the migration's backfill (3 inserts + 3 pointer updates)", async () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await backfillAssetRegistry(db);
    expect(db.query).toHaveBeenCalledTimes(6);

    for (const [stmt] of db.query.mock.calls as Array<[string]>) {
      // Every helper statement must exist in the migration, modulo whitespace.
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      expect(norm(sql)).toContain(norm(stmt));
    }
  });

  it("the entity_type CASE mirrors ENTITY_TYPE_TO_ASSET_TYPE in both places", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const [entityType, assetType] of Object.entries(ENTITY_TYPE_TO_ASSET_TYPE)) {
      expect(sql).toMatch(new RegExp(`WHEN '${entityType}'\\s+THEN '${assetType}'`));
    }
  });
});
