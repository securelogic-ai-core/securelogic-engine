/**
 * forecastEngine.test.ts — ERIP Epic 5: the pure OLS forecaster (ERIP-AD-21/23).
 * Deterministic; exact fit; degenerate-input guards; confidence + trend.
 */

import { describe, expect, it } from "vitest";
import { forecastLinear, type ForecastPoint } from "../lib/forecastEngine.js";

function series(...ys: number[]): ForecastPoint[] {
  return ys.map((y, x) => ({ x, y }));
}

describe("forecastLinear", () => {
  it("fits a perfect line exactly and projects it", () => {
    // y = 2x + 10; points at x=0..4 → 10,12,14,16,18. Project x=9 → 28.
    const r = forecastLinear(series(10, 12, 14, 16, 18), 9);
    expect(r.slope).toBeCloseTo(2, 6);
    expect(r.intercept).toBeCloseTo(10, 4);
    expect(r.r_squared).toBeCloseTo(1, 6);
    expect(r.projected_value).toBeCloseTo(28, 2);
    expect(r.trend).toBe("increasing");
    expect(r.insufficient_data).toBe(false);
  });

  it("clamps the projection to bounds", () => {
    // Steep rise clamped at 100.
    const r = forecastLinear(series(70, 80, 90), 10, { min: 0, max: 100 });
    expect(r.projected_value).toBe(100);
    expect(r.reasoning.some((s) => s.includes("clamped"))).toBe(true);
  });

  it("reports a decreasing trend and 0 floor", () => {
    const r = forecastLinear(series(60, 40, 20), 6, { min: 0, max: 100 });
    expect(r.trend).toBe("decreasing");
    expect(r.projected_value).toBe(0);
  });

  it("labels a flat series stable with a small deadband", () => {
    const r = forecastLinear(series(50, 50, 50, 50), 10);
    expect(r.trend).toBe("stable");
  });

  it("insufficient_data for < 2 points, flat projection", () => {
    const r = forecastLinear(series(42), 5, { min: 0, max: 100 });
    expect(r.insufficient_data).toBe(true);
    expect(r.projected_value).toBe(42);
    expect(r.confidence).toBe(0);
  });

  it("insufficient_data when all x are identical (zero variance)", () => {
    const r = forecastLinear([{ x: 3, y: 10 }, { x: 3, y: 20 }, { x: 3, y: 30 }], 5);
    expect(r.insufficient_data).toBe(true);
    expect(r.slope).toBe(0);
  });

  it("confidence scales with sample size and fit", () => {
    const few = forecastLinear(series(10, 12), 5); // n=2, perfect fit
    const many = forecastLinear(series(10, 12, 14, 16, 18, 20), 10); // n=6, perfect fit
    expect(few.confidence).toBeLessThan(many.confidence);
    expect(many.confidence).toBe(100); // R²=1 × sampleFactor 1
  });

  it("noisy data yields lower confidence than a clean line", () => {
    const clean = forecastLinear(series(10, 20, 30, 40, 50, 60), 10);
    const noisy = forecastLinear(series(10, 25, 15, 45, 30, 60), 10);
    expect(noisy.confidence).toBeLessThan(clean.confidence);
  });

  it("is deterministic", () => {
    const s = series(10, 22, 31, 44, 55);
    expect(forecastLinear(s, 9)).toEqual(forecastLinear(s, 9));
  });
});
