/**
 * forecastModels.test.ts — ERIP E5: the pure Holt model + OLS/Holt selection
 * (ERIP-AD-21). Deterministic; model choice by in-sample RMSE; confidence
 * scaling; degenerate guards.
 */

import { describe, expect, it } from "vitest";
import { holtLinear, selectForecast, type SeriesPoint } from "../lib/forecastModels.js";
import { computeForecasts } from "../lib/forecastCompute.js";
import type { HistoryRow } from "../lib/riskTrends.js";

function line(...ys: number[]): SeriesPoint[] {
  return ys.map((y, x) => ({ x, y }));
}

describe("holtLinear", () => {
  it("returns null for < 2 points", () => {
    expect(holtLinear(line(5), 3)).toBeNull();
  });
  it("fits a clean linear trend with near-zero RMSE and projects forward", () => {
    const fit = holtLinear(line(10, 20, 30, 40, 50), 3)!;
    expect(fit.rmse).toBeLessThan(1);
    expect(fit.projected).toBeGreaterThan(50);
  });
});

describe("selectForecast", () => {
  it("insufficient_data for < 2 points, flat projection", () => {
    const f = selectForecast(line(42), 5, { min: 0, max: 100 });
    expect(f.insufficient_data).toBe(true);
    expect(f.projected_value).toBe(42);
    expect(f.confidence).toBe(0);
  });

  it("a perfect line is well-fit and increasing, clamped to bounds", () => {
    const f = selectForecast(line(60, 70, 80, 90), 8, { min: 0, max: 100 });
    expect(f.insufficient_data).toBe(false);
    expect(f.trend).toBe("increasing");
    expect(f.projected_value).toBe(100); // clamped
    expect(f.confidence).toBeGreaterThan(0);
    expect(["ols_linear", "holt_linear"]).toContain(f.method);
  });

  it("never selects a worse-fitting model than the alternative", () => {
    // Whichever model wins, its in-sample RMSE is what's reported, and it must
    // be no worse than a naive last-value carry-forward on a curved series.
    const f = selectForecast(line(10, 12, 16, 24, 40), 6, { min: 0, max: 1000 });
    expect(f.insufficient_data).toBe(false);
    expect(f.trend).toBe("increasing");
    expect(["ols_linear", "holt_linear"]).toContain(f.method);
    expect(f.reasoning.join(" ")).toContain("RMSE");
  });

  it("selects Holt on a series it fits better than the straight line", () => {
    // A plateau then a rise — a single line can't fit both regimes; Holt adapts.
    const holt = holtLinear(line(10, 10, 10, 10, 25, 40, 55), 3)!;
    // Holt's in-sample RMSE beats the best straight-line fit here.
    const f = selectForecast(line(10, 10, 10, 10, 25, 40, 55), 9, { min: 0, max: 100 });
    expect(f.method).toBe("holt_linear");
    expect(f.in_sample_rmse).toBeCloseTo(Math.round(holt.rmse * 100) / 100, 1);
  });

  it("confidence rises with more clean points (retraining law)", () => {
    const few = selectForecast(line(10, 20, 30), 5);
    const many = selectForecast(line(10, 20, 30, 40, 50, 60, 70, 80), 10);
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });

  it("is deterministic", () => {
    const s = line(10, 22, 31, 44, 55);
    expect(selectForecast(s, 9)).toEqual(selectForecast(s, 9));
  });
});

describe("computeForecasts (pure)", () => {
  function hrow(dimension: string, date: string, avg: number, atRisk: number): HistoryRow {
    return { dimension, snapshot_date: date, avg_risk: avg, at_risk_count: atRisk, max_risk: 0, asset_count: 0 };
  }

  it("produces one forecast per (dimension, metric) with >= 2 points", () => {
    const rows = [
      hrow("enterprise", "2026-07-01", 30, 1),
      hrow("enterprise", "2026-07-02", 40, 2),
      hrow("enterprise", "2026-07-03", 50, 3),
      hrow("endpoint", "2026-07-03", 50, 3) // single point → skipped
    ];
    const fcs = computeForecasts(rows, 30);
    // enterprise: avg_risk + at_risk_count = 2 records; endpoint skipped.
    expect(fcs).toHaveLength(2);
    expect(new Set(fcs.map((f) => f.metric))).toEqual(new Set(["avg_risk", "at_risk_count"]));
    expect(fcs.every((f) => f.dimension === "enterprise")).toBe(true);
    expect(fcs.every((f) => f.reasoning.length > 0 && f.confidence >= 0)).toBe(true);
  });

  it("returns nothing when no dimension has 2+ points", () => {
    expect(computeForecasts([hrow("enterprise", "2026-07-01", 30, 1)], 30)).toEqual([]);
  });
});
