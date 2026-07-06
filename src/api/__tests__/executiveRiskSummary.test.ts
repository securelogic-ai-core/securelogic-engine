/**
 * executiveRiskSummary.test.ts — ERIP Epic 4: the pure executive composer
 * (ERIP-AD-19/20). Deterministic; composes canonical rollup + posture.
 */

import { describe, expect, it } from "vitest";
import { composeExecutiveRiskSummary } from "../lib/executiveRiskSummary.js";
import { rollupRiskByDimension, type AssetRiskRow } from "../lib/riskDimensionRollup.js";

function rows(...xs: Array<[string, number]>): AssetRiskRow[] {
  return xs.map(([asset_type, own_risk]) => ({ asset_type, criticality: null, own_risk }));
}

describe("composeExecutiveRiskSummary", () => {
  it("headline reflects the worst-case asset and inventory totals", () => {
    const rollup = rollupRiskByDimension(rows(["vendor", 90], ["endpoint", 40], ["cloud_resource", 0]));
    const s = composeExecutiveRiskSummary(rollup, null);
    expect(s.headline.overall_risk_band).toBe("critical"); // peak 90
    expect(s.headline.peak_risk).toBe(90);
    expect(s.headline.total_assets).toBe(3);
    expect(s.headline.at_risk_assets).toBe(2);
    expect(s.posture).toBeNull();
  });

  it("top_dimensions lists only at-risk dimensions, worst first, max 3", () => {
    const rollup = rollupRiskByDimension(
      rows(["a", 95], ["b", 70], ["c", 40], ["d", 20], ["e", 0])
    );
    const s = composeExecutiveRiskSummary(rollup, null);
    expect(s.headline.top_dimensions.map((d) => d.dimension)).toEqual(["a", "b", "c"]);
    expect(s.headline.top_dimensions.every((d) => d.at_risk_count > 0)).toBe(true);
  });

  it("heatmap carries the band matrix per dimension", () => {
    const rollup = rollupRiskByDimension(rows(["vendor", 90], ["vendor", 0]));
    const s = composeExecutiveRiskSummary(rollup, null);
    const vendor = s.heatmap.find((h) => h.dimension === "vendor")!;
    expect(vendor.bands).toMatchObject({ critical: 1, none: 1 });
  });

  it("carries posture context when present", () => {
    const rollup = rollupRiskByDimension(rows(["vendor", 30]));
    const s = composeExecutiveRiskSummary(rollup, {
      overall_score: 72,
      overall_severity: "Moderate",
      snapshot_date: "2026-07-01"
    });
    expect(s.posture).toEqual({ overall_score: 72, overall_severity: "Moderate", snapshot_date: "2026-07-01" });
  });

  it("empty inventory yields a 'none' band and zero counts", () => {
    const s = composeExecutiveRiskSummary(rollupRiskByDimension([]), null);
    expect(s.headline.overall_risk_band).toBe("none");
    expect(s.headline.total_assets).toBe(0);
    expect(s.heatmap).toEqual([]);
  });
});
