import { describe, it, expect } from "vitest";
import {
  normalizeGlobalQuery,
  rankHits,
  runGlobalSearch,
  PER_TYPE_LIMIT,
  MAX_QUERY_LENGTH,
  type SearchHit,
  type SearchQueryable,
} from "../lib/globalSearch.js";

function fakeClient(routes: Array<{ match: RegExp; rows?: any[]; throws?: Error }>): {
  client: SearchQueryable;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client: SearchQueryable = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const hit = routes.find((r) => r.match.test(sql));
      if (hit?.throws) throw hit.throws;
      return { rows: (hit?.rows ?? []) as any[] };
    },
  };
  return { client, calls };
}

const ORG = "11111111-1111-1111-1111-111111111111";

describe("normalizeGlobalQuery (pure)", () => {
  it("trims and accepts a usable query", () => {
    expect(normalizeGlobalQuery("  acme ")).toBe("acme");
  });
  it("rejects short, over-long, and non-string input", () => {
    expect(normalizeGlobalQuery("a")).toBeNull();
    expect(normalizeGlobalQuery("  a ")).toBeNull();
    expect(normalizeGlobalQuery("x".repeat(MAX_QUERY_LENGTH + 1))).toBeNull();
    expect(normalizeGlobalQuery(42)).toBeNull();
    expect(normalizeGlobalQuery(undefined)).toBeNull();
    expect(normalizeGlobalQuery(["acme"])).toBeNull();
  });
});

describe("rankHits (pure)", () => {
  const hit = (title: string, id = title): SearchHit => ({
    type: "finding",
    id,
    title,
    subtitle: null,
    href: `/findings/${id}`,
  });

  it("orders exact match, then prefix, then the rest", () => {
    const ranked = rankHits(
      [hit("Acme Corp breach"), hit("Vendor: acme"), hit("Acme")],
      "acme"
    );
    expect(ranked.map((h) => h.title)).toEqual([
      "Acme",
      "Acme Corp breach",
      "Vendor: acme",
    ]);
  });

  it("is stable within a tier (keeps per-type query order)", () => {
    const ranked = rankHits([hit("Acme One", "1"), hit("Acme Two", "2")], "acme");
    expect(ranked.map((h) => h.id)).toEqual(["1", "2"]);
  });

  it("matches titles case-insensitively", () => {
    const ranked = rankHits([hit("zebra"), hit("ACME")], "acme");
    expect(ranked[0]!.title).toBe("ACME");
  });
});

describe("runGlobalSearch", () => {
  it("runs one org-scoped, limit-bound query per core type and skips assets when excluded", async () => {
    const { client, calls } = fakeClient([]);
    await runGlobalSearch(client, ORG, "acme", { includeAssets: false });

    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call.params).toEqual([ORG, "%acme%", PER_TYPE_LIMIT]);
      expect(call.sql).toMatch(/organization_id = \$1/);
    }
    expect(calls.some((c) => /asset_search_index_v/.test(c.sql))).toBe(false);
    expect(calls.some((c) => /FROM findings/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /FROM risks/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /FROM vendors/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /FROM ai_systems/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /FROM controls/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /FROM obligations/.test(c.sql))).toBe(true);
  });

  it("includes the asset section only when the route says so", async () => {
    const { client, calls } = fakeClient([
      {
        match: /asset_search_index_v/,
        rows: [{ id: "as1", title: "prod-web-01", subtitle: "endpoint" }],
      },
    ]);
    const out = await runGlobalSearch(client, ORG, "prod", { includeAssets: true });

    expect(calls).toHaveLength(7);
    const assetHit = out.hits.find((h) => h.type === "asset");
    expect(assetHit).toEqual({
      type: "asset",
      id: "as1",
      title: "prod-web-01",
      subtitle: "endpoint",
      href: "/assets/as1",
    });
  });

  it("escapes LIKE metacharacters in the bound pattern", async () => {
    const { client, calls } = fakeClient([]);
    await runGlobalSearch(client, ORG, "50%_off", { includeAssets: false });
    expect(calls[0]!.params[1]).toBe("%50\\%\\_off%");
  });

  it("isolates a failing section instead of failing the search", async () => {
    const boom = new Error("relation missing");
    const failures: Array<{ type: string; err: unknown }> = [];
    const { client } = fakeClient([
      { match: /FROM findings/, throws: boom },
      { match: /FROM risks/, rows: [{ id: "r1", title: "Acme risk", subtitle: "High" }] },
    ]);

    const out = await runGlobalSearch(client, ORG, "acme", {
      includeAssets: false,
      onTypeError: (type, err) => failures.push({ type, err }),
    });

    expect(failures).toEqual([{ type: "finding", err: boom }]);
    expect(out.hits).toEqual([
      { type: "risk", id: "r1", title: "Acme risk", subtitle: "High", href: "/risks/r1" },
    ]);
  });

  it("drops rows without id or title and nulls missing subtitles", async () => {
    const { client } = fakeClient([
      {
        match: /FROM risks/,
        rows: [
          { id: "r1", title: null, subtitle: "High" },
          { id: null, title: "ghost", subtitle: null },
          { id: "r2", title: "Acme exposure" },
        ],
      },
    ]);
    const out = await runGlobalSearch(client, ORG, "acme", { includeAssets: false });
    expect(out.hits).toEqual([
      {
        type: "risk",
        id: "r2",
        title: "Acme exposure",
        subtitle: null,
        href: "/risks/r2",
      },
    ]);
    expect(out.total).toBe(1);
  });

  it("ranks across sections: an exact title beats an earlier section's substring match", async () => {
    const { client } = fakeClient([
      {
        match: /FROM findings/,
        rows: [{ id: "f1", title: "Acme credential leak", subtitle: "high" }],
      },
      { match: /FROM vendors/, rows: [{ id: "v1", title: "Acme", subtitle: "critical" }] },
    ]);
    const out = await runGlobalSearch(client, ORG, "acme", { includeAssets: false });
    expect(out.hits.map((h) => h.id)).toEqual(["v1", "f1"]);
    expect(out.query).toBe("acme");
    expect(out.total).toBe(2);
  });
});
