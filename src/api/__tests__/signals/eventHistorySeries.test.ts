/**
 * eventHistorySeries.test.ts — Intelligence Pipeline Hardening (item 6).
 *
 * Pins the predictive series over event history: daily counts → forecast points
 * (x = days since first), fed to the deterministic OLS engine. Because the
 * series counts EVENTS (from the timeline), duplicate raw signals never inflate
 * a day's count.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../infra/postgres.js", () => ({ pgElevated: { query: vi.fn() } }));

import { toForecastPoints, type DailyCount } from "../../lib/signals/eventHistorySeries.js";
import { forecastLinear } from "../../lib/forecastEngine.js";

describe("toForecastPoints", () => {
  it("maps a daily series to x=days-since-first, y=count", () => {
    const series: DailyCount[] = [
      { day: "2026-07-01", count: 2 },
      { day: "2026-07-03", count: 5 },
      { day: "2026-07-06", count: 9 }
    ];
    const pts = toForecastPoints(series);
    expect(pts).toEqual([
      { x: 0, y: 2 },
      { x: 2, y: 5 },
      { x: 5, y: 9 }
    ]);
  });

  it("empty series → no points", () => {
    expect(toForecastPoints([])).toEqual([]);
  });

  it("a rising event-activity series forecasts an increasing trend", () => {
    const series: DailyCount[] = [
      { day: "2026-07-01", count: 1 },
      { day: "2026-07-02", count: 3 },
      { day: "2026-07-03", count: 5 },
      { day: "2026-07-04", count: 7 }
    ];
    const pts = toForecastPoints(series);
    const fc = forecastLinear(pts, pts[pts.length - 1].x + 7, { min: 0, max: Number.MAX_SAFE_INTEGER });
    expect(fc.trend).toBe("increasing");
    expect(fc.projected_value).toBeGreaterThan(7);
    expect(fc.insufficient_data).toBe(false);
  });
});
