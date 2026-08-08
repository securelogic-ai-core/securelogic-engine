/**
 * EC graph asset rendering + the 500 regression (#693 / DS-12).
 *
 * Root cause of the verified staging 500: "asset" joined NODE_TYPES while the
 * graph page's NODE_COLORS kept 4 entries, and the legend indexed
 * NODE_COLORS[t].fill unguarded — the server component threw on EVERY render
 * (engine graph API 200, page 500). Asset nodes also rendered gray with
 * truncated-UUID labels because buildNodeNameMap had no asset source.
 *
 * Pinned here:
 *  1. every NODE_TYPES entry has an explicit NODE_COLORS entry,
 *  2. the legend goes through the fallback accessor (a future node type
 *     degrades to gray instead of taking the route down),
 *  3. buildNodeNameMap resolves asset names by asset_id,
 *  4. the page loads assets and feeds them to the name map,
 *  5. the route group has an error boundary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NODE_TYPES } from "../enterpriseContext";
import { buildNodeNameMap, nodeDisplayName } from "../enterpriseGraphLayout";

const appRoot = join(__dirname, "../..");
const pageSrc = readFileSync(
  join(appRoot, "app/enterprise-context/graph/page.tsx"),
  "utf8"
);

describe("NODE_COLORS covers NODE_TYPES (the 500 regression)", () => {
  const colorKeys = new Set(
    [...pageSrc.matchAll(/^  ([a-z_]+): +\{ fill:/gm)].map((m) => m[1]!)
  );

  it.each([...NODE_TYPES])("has an explicit color for %s", (t) => {
    expect(colorKeys.has(t)).toBe(true);
  });

  it("the legend uses the fallback accessor, never raw indexing", () => {
    expect(pageSrc).toMatch(/nodeColors\(t\)\.fill/);
    // No raw indexing in JSX (the comment explaining the old bug may name it).
    expect(pageSrc).not.toMatch(/background: NODE_COLORS\[/);
    expect(pageSrc).not.toMatch(/= NODE_COLORS\[node\.node_type\]/);
  });
});

describe("asset names resolve in the graph", () => {
  it("buildNodeNameMap maps assets by asset_id", () => {
    const map = buildNodeNameMap({
      assets: [{ asset_id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Payments DB" }],
    });
    expect(
      nodeDisplayName(map, "asset", "aaaaaaaa-1111-4111-8111-111111111111")
    ).toBe("Payments DB");
  });

  it("unknown asset ids still fall back to short ids, never invented names", () => {
    const map = buildNodeNameMap({ assets: [] });
    expect(
      nodeDisplayName(map, "asset", "bbbbbbbb-2222-4222-8222-222222222222")
    ).toBe("bbbbbbbb…");
  });

  it("the page loads the asset registry and feeds the name map", () => {
    expect(pageSrc).toMatch(/getAssets\(token, \{ limit: 100 \}\)/);
    expect(pageSrc).toMatch(/assets: assetsResult\.ok \? assetsResult\.assets : \[\]/);
  });
});

describe("route-group error boundary", () => {
  it("enterprise-context has an error.tsx client boundary with reset", () => {
    const p = join(appRoot, "app/enterprise-context/error.tsx");
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, "utf8");
    expect(src).toMatch(/^"use client";/);
    expect(src).toMatch(/reset: \(\) => void/);
  });
});
