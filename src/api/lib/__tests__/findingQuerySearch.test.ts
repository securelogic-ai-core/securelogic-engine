/**
 * findingQuerySearch.test.ts — free-text search resolution for the Risk Findings
 * queue. Pure normalize/pattern helpers + the indirect (CVE + entity) id
 * resolver against a mocked, org-scoped client (database-free unit lane).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSearchQuery,
  searchLikePattern,
  resolveSearchFindingIds,
} from "../findingQuerySearch.js";
import type { Queryable } from "../findingEntitySearch.js";

describe("normalizeSearchQuery", () => {
  it("trims and accepts 1..200 chars", () => {
    expect(normalizeSearchQuery("  MFA  ")).toBe("MFA");
    expect(normalizeSearchQuery("a")).toBe("a");
    expect(normalizeSearchQuery("x".repeat(200))).toBe("x".repeat(200));
  });
  it("rejects non-strings, empty, and oversized", () => {
    expect(normalizeSearchQuery(null)).toBeNull();
    expect(normalizeSearchQuery(42)).toBeNull();
    expect(normalizeSearchQuery("   ")).toBeNull();
    expect(normalizeSearchQuery("x".repeat(201))).toBeNull();
  });
});

describe("searchLikePattern", () => {
  it("wraps in % and escapes LIKE wildcards", () => {
    expect(searchLikePattern("abc")).toBe("%abc%");
    expect(searchLikePattern("50%_off\\x")).toBe("%50\\%\\_off\\\\x%");
  });
});

/**
 * A mock client that answers by SQL shape: the two CVE joins return finding ids,
 * every entity-name lookup (vendors/ai_systems/controls/obligations) returns
 * empty so searchFindingsByEntity short-circuits. Records params for assertions.
 */
function makeClient(opts: {
  sigCveRows?: Array<{ id: string }>;
  eventCveRows?: Array<{ id: string }>;
} = {}): { client: Queryable; calls: Array<{ text: string; params: unknown[] }> } {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const client: Queryable = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      if (text.includes("JOIN cyber_signals cs")) {
        return { rows: opts.sigCveRows ?? [], rowCount: (opts.sigCveRows ?? []).length };
      }
      if (text.includes("JOIN intelligence_events e")) {
        return { rows: opts.eventCveRows ?? [], rowCount: (opts.eventCveRows ?? []).length };
      }
      // Entity-name source lookups (searchFindingsByEntity step 1) → no matches.
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, calls };
}

describe("resolveSearchFindingIds", () => {
  const ORG = "org-1";

  it("unions CVE-matched finding ids across signals and events, de-duplicated", async () => {
    const { client } = makeClient({
      sigCveRows: [{ id: "f1" }, { id: "f2" }],
      eventCveRows: [{ id: "f2" }, { id: "f3" }],
    });
    const ids = await resolveSearchFindingIds(client, ORG, "CVE-2026-1234");
    expect([...ids].sort()).toEqual(["f1", "f2", "f3"]);
  });

  it("scopes every query to the calling org and binds the pattern (never inlines)", async () => {
    const { client, calls } = makeClient({ sigCveRows: [{ id: "f1" }] });
    await resolveSearchFindingIds(client, ORG, "acme");
    // The CVE queries carry (org, pattern, limit) — org first, pattern bound.
    const cve = calls.filter((c) => c.text.includes("affected_cve ILIKE"));
    expect(cve.length).toBe(2);
    for (const c of cve) {
      expect(c.params[0]).toBe(ORG);
      expect(c.params[1]).toBe("%acme%");
    }
  });

  it("runs entity-name resolution for a 2+ char query", async () => {
    const { client, calls } = makeClient();
    await resolveSearchFindingIds(client, ORG, "microsoft");
    // searchFindingsByEntity queries the four entity tables by name.
    const entityLookups = calls.filter(
      (c) => /FROM (vendors|ai_systems|controls|obligations)/.test(c.text) && c.text.includes("ILIKE")
    );
    expect(entityLookups.length).toBe(4);
  });

  it("skips entity-name resolution for a 1-char query (too short) but still does CVE", async () => {
    const { client, calls } = makeClient({ sigCveRows: [{ id: "f9" }] });
    const ids = await resolveSearchFindingIds(client, ORG, "x");
    expect(ids).toContain("f9");
    const entityLookups = calls.filter((c) => /FROM (vendors|ai_systems)/.test(c.text));
    expect(entityLookups.length).toBe(0);
  });

  it("returns empty when nothing matches", async () => {
    const { client } = makeClient();
    expect(await resolveSearchFindingIds(client, ORG, "zzzz")).toEqual([]);
  });
});
