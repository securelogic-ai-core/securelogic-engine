/**
 * riskDimensionRollup.test.ts — ERIP Epic 3: the pure dimensional risk rollup
 * (ERIP-AD-15/16). Deterministic; band boundaries; ordering.
 */

import { describe, expect, it } from "vitest";
import { rollupRiskByDimension, riskBand, type AssetRiskRow } from "../lib/riskDimensionRollup.js";

function row(asset_type: string, own_risk: number, criticality: string | null = null): AssetRiskRow {
  return { asset_type, criticality, own_risk };
}

describe("riskBand", () => {
  it("maps scores to canonical bands at the boundaries", () => {
    expect(riskBand(80)).toBe("critical");
    expect(riskBand(79)).toBe("high");
    expect(riskBand(60)).toBe("high");
    expect(riskBand(59)).toBe("moderate");
    expect(riskBand(30)).toBe("moderate");
    expect(riskBand(29)).toBe("low");
    expect(riskBand(1)).toBe("low");
    expect(riskBand(0)).toBe("none");
  });
});

describe("rollupRiskByDimension", () => {
  it("empty input yields a zeroed enterprise rollup and no dimensions", () => {
    const r = rollupRiskByDimension([]);
    expect(r.by_asset_type).toEqual([]);
    expect(r.overall).toMatchObject({ dimension: "enterprise", asset_count: 0, at_risk_count: 0, max_risk: 0, avg_risk: 0 });
  });

  it("aggregates per asset_type with count/at-risk/max/avg/bands", () => {
    const r = rollupRiskByDimension([
      row("vendor", 90),
      row("vendor", 0),
      row("endpoint", 40),
      row("endpoint", 60),
      row("cloud_resource", 0)
    ]);
    const vendor = r.by_asset_type.find((d) => d.dimension === "vendor")!;
    expect(vendor).toMatchObject({ asset_count: 2, at_risk_count: 1, max_risk: 90, avg_risk: 45 });
    expect(vendor.bands).toMatchObject({ critical: 1, none: 1 });

    const endpoint = r.by_asset_type.find((d) => d.dimension === "endpoint")!;
    expect(endpoint).toMatchObject({ asset_count: 2, at_risk_count: 2, max_risk: 60, avg_risk: 50 });
    expect(endpoint.bands).toMatchObject({ high: 1, moderate: 1 });

    expect(r.overall).toMatchObject({ asset_count: 5, at_risk_count: 3, max_risk: 90 });
  });

  it("orders dimensions by peak risk desc, then count, then name", () => {
    const r = rollupRiskByDimension([
      row("low_type", 20),
      row("hot_type", 95),
      row("mid_type", 50),
      row("mid_type", 50)
    ]);
    expect(r.by_asset_type.map((d) => d.dimension)).toEqual(["hot_type", "mid_type", "low_type"]);
  });

  it("is deterministic", () => {
    const rows = [row("a", 10), row("b", 90), row("a", 50)];
    expect(rollupRiskByDimension(rows)).toEqual(rollupRiskByDimension(rows));
  });
});
