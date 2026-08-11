/**
 * assetSearchResolver.test.ts — unit tests (client mocked) for the shared
 * "search term → canonical asset IDs" resolver. Proves the platform search
 * semantics in one place: 2–120 bounds, LIKE-wildcard escaping, the UUID
 * exact path, per-asset dedup/ranking SQL, the deterministic cap, the type
 * narrowing, and the dual identity (canonical asset_id + backing id) every
 * consumer keys on. Real-Postgres rows (and the view itself) are covered by
 * test/isolation/assetSearchIndexView.test.ts.
 */

import { describe, expect, it, vi } from "vitest";

import {
  ASSET_SEARCH_MAX_MATCHES,
  assetSearchPattern,
  backingIdsOf,
  normalizeAssetSearchTerm,
  resolveAssetSearch,
  type AssetSearchMatch,
  type Queryable
} from "../lib/assetSearchResolver.js";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function mockClient(rows: unknown[] = []): Queryable & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe("normalizeAssetSearchTerm", () => {
  it("trims and accepts the 2–120 bounds inclusive", () => {
    expect(normalizeAssetSearchTerm("  Acme  ")).toBe("Acme");
    expect(normalizeAssetSearchTerm("ab")).toBe("ab");
    expect(normalizeAssetSearchTerm("a".repeat(120))).toBe("a".repeat(120));
  });

  it("rejects out-of-bounds and non-string terms", () => {
    expect(normalizeAssetSearchTerm("a")).toBeNull();
    expect(normalizeAssetSearchTerm(" a ")).toBeNull(); // trimmed length decides
    expect(normalizeAssetSearchTerm("a".repeat(121))).toBeNull();
    expect(normalizeAssetSearchTerm("")).toBeNull();
    expect(normalizeAssetSearchTerm(undefined)).toBeNull();
    expect(normalizeAssetSearchTerm(["a", "b"])).toBeNull();
  });
});

describe("assetSearchPattern", () => {
  it("escapes LIKE wildcards so customer literals stay literal", () => {
    expect(assetSearchPattern("Acme")).toBe("%Acme%");
    expect(assetSearchPattern("50%_off\\x")).toBe("%50\\%\\_off\\\\x%");
  });
});

describe("resolveAssetSearch — text path", () => {
  it("queries the search index org-scoped with the escaped pattern, deduped and ranked", async () => {
    const client = mockClient([
      { asset_id: "as-1", asset_type: "vendor", backing_kind: "vendors", backing_id: "v-1", term_kind: "name" },
      { asset_id: "as-2", asset_type: "endpoint", backing_kind: "endpoints", backing_id: "ep-1", term_kind: "hostname" }
    ]);

    const r = await resolveAssetSearch(client, ORG, "acme");

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM asset_search_index_v");
    expect(sql).toContain("DISTINCT ON (asset_id)");
    expect(sql).toContain("organization_id = $1");
    expect(sql).toContain("term ILIKE $2");
    // The full rank vocabulary — one definition of "which identifier wins".
    expect(sql).toContain("WHEN 'name' THEN 0");
    expect(sql).toContain("WHEN 'hostname' THEN 1");
    expect(sql).toContain("WHEN 'cloud_account' THEN 2");
    expect(sql).toContain("WHEN 'alias' THEN 3");
    // No types → NULL narrows nothing; cap+1 to detect truncation.
    expect(params).toEqual([ORG, "%acme%", null, ASSET_SEARCH_MAX_MATCHES + 1]);

    expect(r.truncated).toBe(false);
    expect(r.matches).toEqual([
      { asset_id: "as-1", asset_type: "vendor", backing_kind: "vendors", backing_id: "v-1", matched_kind: "name" },
      { asset_id: "as-2", asset_type: "endpoint", backing_kind: "endpoints", backing_id: "ep-1", matched_kind: "hostname" }
    ]);
  });

  it("narrows by assetTypes BEFORE the cap when provided", async () => {
    const client = mockClient([]);
    await resolveAssetSearch(client, ORG, "prod", { assetTypes: ["endpoint"] });
    const [, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toEqual(["endpoint"]);
  });

  it("reports truncation and slices to the cap when the cap is hit", async () => {
    const over = Array.from({ length: 4 }, (_, i) => ({
      asset_id: `as-${i}`,
      asset_type: "vendor",
      backing_kind: "vendors",
      backing_id: `v-${i}`,
      term_kind: "name"
    }));
    const client = mockClient(over);

    const r = await resolveAssetSearch(client, ORG, "acme", { maxMatches: 3 });

    const [, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe(4); // cap + 1
    expect(r.truncated).toBe(true);
    expect(r.matches).toHaveLength(3);
  });
});

describe("resolveAssetSearch — UUID path", () => {
  it("a UUID term is an EXACT identity match on asset_id/backing_id, never a contains", async () => {
    const client = mockClient([
      { asset_id: ASSET_UUID, asset_type: "cloud_resource", backing_kind: "cloud_resources", backing_id: ASSET_UUID }
    ]);

    const r = await resolveAssetSearch(client, ORG, ASSET_UUID);

    const [sql, params] = client.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM asset_registry_v");
    expect(sql).toContain("asset_id = $2::uuid OR backing_id = $2::uuid");
    expect(sql).not.toContain("ILIKE");
    expect(params[0]).toBe(ORG);
    expect(params[1]).toBe(ASSET_UUID);

    expect(r.matches).toEqual([
      {
        asset_id: ASSET_UUID,
        asset_type: "cloud_resource",
        backing_kind: "cloud_resources",
        backing_id: ASSET_UUID,
        matched_kind: "id"
      }
    ]);
  });
});

describe("backingIdsOf", () => {
  it("extracts only the requested backing kind's ids (federated-list helper)", () => {
    const matches: AssetSearchMatch[] = [
      { asset_id: "a1", asset_type: "vendor", backing_kind: "vendors", backing_id: "v-1", matched_kind: "name" },
      { asset_id: "a2", asset_type: "endpoint", backing_kind: "endpoints", backing_id: "ep-1", matched_kind: "hostname" },
      { asset_id: "a3", asset_type: "vendor", backing_kind: "vendors", backing_id: "v-2", matched_kind: "alias" }
    ];
    expect(backingIdsOf(matches, "vendors")).toEqual(["v-1", "v-2"]);
    expect(backingIdsOf(matches, "ai_systems")).toEqual([]);
  });
});
