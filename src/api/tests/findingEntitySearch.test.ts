import { describe, it, expect } from "vitest";
import {
  normalizeEntityQuery,
  entityQueryPattern,
  searchFindingsByEntity,
  type Queryable,
} from "../lib/findingEntitySearch.js";

function fakeClient(routes: Array<{ match: RegExp; rows: any[] }>): {
  client: Queryable;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client: Queryable = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ sql: text, params });
      const hit = routes.find((r) => r.match.test(text));
      const rows = hit ? hit.rows : [];
      return { rows, rowCount: rows.length };
    },
  };
  return { client, calls };
}

const ORG = "11111111-1111-1111-1111-111111111111";

describe("normalizeEntityQuery (pure)", () => {
  it("trims and accepts a usable query", () => {
    expect(normalizeEntityQuery("  Microsoft ")).toBe("Microsoft");
  });
  it("rejects short, long, and non-string input", () => {
    expect(normalizeEntityQuery("m")).toBeNull();
    expect(normalizeEntityQuery("x".repeat(121))).toBeNull();
    expect(normalizeEntityQuery(42 as unknown)).toBeNull();
    expect(normalizeEntityQuery(undefined)).toBeNull();
  });
});

describe("entityQueryPattern (pure)", () => {
  it("wraps with wildcards and escapes LIKE metacharacters", () => {
    expect(entityQueryPattern("Microsoft")).toBe("%Microsoft%");
    expect(entityQueryPattern("100%_done\\x")).toBe("%100\\%\\_done\\\\x%");
  });
});

describe("searchFindingsByEntity", () => {
  it("resolves a vendor's findings across signal-link, event-bridge, and assessment paths", async () => {
    const { client, calls } = fakeClient([
      { match: /FROM vendors\s+WHERE organization_id/i, rows: [{ id: "v1", name: "Microsoft" }] },
      { match: /FROM signal_vendor_links/i, rows: [{ signal_id: "s1" }] },
      { match: /source_type IN \('cyber_signal', 'signal'\)/i, rows: [{ id: "f-signal" }] },
      { match: /FROM intelligence_event_sources/i, rows: [{ event_id: "e1" }] },
      { match: /source_type = 'intelligence_event'/i, rows: [{ id: "f-event" }] },
      { match: /JOIN vendor_assessments src/i, rows: [{ id: "f-assessment" }] },
      { match: /JOIN vendor_reviews src/i, rows: [{ id: "f-cycle" }] },
    ]);
    const out = await searchFindingsByEntity(client, ORG, "Microsoft");
    expect(out.entities).toEqual([{ type: "vendor", id: "v1", name: "Microsoft" }]);
    expect(out.finding_ids.sort()).toEqual(["f-assessment", "f-cycle", "f-event", "f-signal"]);
    // every org-scoped query binds the caller's org as $1
    for (const c of calls.filter((c) => /organization_id = \$1/.test(c.sql))) {
      expect(c.params[0]).toBe(ORG);
    }
  });

  it("de-duplicates a finding reachable via multiple paths", async () => {
    const { client } = fakeClient([
      { match: /FROM vendors\s+WHERE organization_id/i, rows: [{ id: "v1", name: "Acme" }] },
      { match: /FROM signal_vendor_links/i, rows: [{ signal_id: "s1" }] },
      { match: /source_type IN \('cyber_signal', 'signal'\)/i, rows: [{ id: "f-dup" }] },
      { match: /FROM intelligence_event_sources/i, rows: [{ event_id: "e1" }] },
      { match: /source_type = 'intelligence_event'/i, rows: [{ id: "f-dup" }] },
    ]);
    const out = await searchFindingsByEntity(client, ORG, "Acme");
    expect(out.finding_ids).toEqual(["f-dup"]);
  });

  it("returns empty (and issues no finding queries) when no entity matches", async () => {
    const { client, calls } = fakeClient([]);
    const out = await searchFindingsByEntity(client, ORG, "NoSuchCorp");
    expect(out).toEqual({ entities: [], finding_ids: [] });
    // Only the 4 entity-name lookups + the shared asset-search pass ran — no
    // finding queries.
    expect(calls.length).toBe(5);
    expect(calls[4].sql).toContain("asset_search_index_v");
    expect(calls.every((c) => !/FROM findings/i.test(c.sql))).toBe(true);
  });

  it("folds a vendor-backed asset match (e.g. a product alias) into the vendor path", async () => {
    const { client, calls } = fakeClient([
      // No entity-name match anywhere…
      // …but the shared asset-search pass finds a vendor-backed asset.
      {
        match: /FROM asset_search_index_v/i,
        rows: [{ asset_id: "a1", asset_type: "vendor", backing_kind: "vendors", backing_id: "v9", term_kind: "alias" }],
      },
      // Hydration of the extra vendor's name (id = ANY path).
      { match: /FROM vendors\s+WHERE organization_id = \$1 AND id = ANY/i, rows: [{ id: "v9", name: "Aliased Corp" }] },
      { match: /FROM signal_vendor_links/i, rows: [{ signal_id: "s1" }] },
      { match: /source_type IN \('cyber_signal', 'signal'\)/i, rows: [{ id: "f-alias" }] },
    ]);
    const out = await searchFindingsByEntity(client, ORG, "WdgtSuite");
    expect(out.entities).toEqual([{ type: "vendor", id: "v9", name: "Aliased Corp" }]);
    expect(out.finding_ids).toContain("f-alias");
    // Detail-backed matches (no finding path) must not create entity lookups.
    expect(calls.filter((c) => /FROM endpoints/i.test(c.sql))).toHaveLength(0);
  });

  it("ignores detail-backed asset matches (endpoints etc.) — no finding path exists yet", async () => {
    const { client } = fakeClient([
      {
        match: /FROM asset_search_index_v/i,
        rows: [{ asset_id: "ep1", asset_type: "endpoint", backing_kind: "endpoints", backing_id: "ep1", term_kind: "hostname" }],
      },
    ]);
    const out = await searchFindingsByEntity(client, ORG, "web-01");
    expect(out).toEqual({ entities: [], finding_ids: [] });
  });

  it("searches obligations by title and resolves obligation_review findings", async () => {
    const { client } = fakeClient([
      { match: /FROM obligations\s+WHERE organization_id/i, rows: [{ id: "o1", name: "PCI-DSS" }] },
      { match: /JOIN obligation_assessments src/i, rows: [{ id: "f-obl" }] },
    ]);
    const out = await searchFindingsByEntity(client, ORG, "PCI");
    expect(out.entities).toEqual([{ type: "obligation", id: "o1", name: "PCI-DSS" }]);
    expect(out.finding_ids).toEqual(["f-obl"]);
  });

  it("caps returned finding ids at maxFindings", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}` }));
    const { client } = fakeClient([
      { match: /FROM vendors\s+WHERE organization_id/i, rows: [{ id: "v1", name: "Acme" }] },
      { match: /FROM signal_vendor_links/i, rows: [{ signal_id: "s1" }] },
      { match: /source_type IN \('cyber_signal', 'signal'\)/i, rows: many },
    ]);
    const out = await searchFindingsByEntity(client, ORG, "Acme", { maxFindings: 3 });
    expect(out.finding_ids.length).toBe(3);
  });
});
