/**
 * riskTrends.test.ts — ERIP E4: the pure trend/KPI/comparison/CSV core.
 * Deterministic; direction deadband; CSV escaping.
 */

import { describe, expect, it } from "vitest";
import {
  buildDimensionTrend,
  buildKpiScorecard,
  comparePoints,
  historyToCsv,
  type HistoryPoint
} from "../lib/riskTrends.js";

function pt(date: string, avg: number, atRisk = 0, max = 0, count = 0): HistoryPoint {
  return { snapshot_date: date, avg_risk: avg, at_risk_count: atRisk, max_risk: max, asset_count: count };
}

describe("buildDimensionTrend", () => {
  it("sorts by date and computes first→last deltas + direction", () => {
    const t = buildDimensionTrend("enterprise", [pt("2026-07-03", 40, 2), pt("2026-07-01", 20, 1), pt("2026-07-02", 30, 1)]);
    expect(t.points.map((p) => p.snapshot_date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(t.current?.snapshot_date).toBe("2026-07-03");
    expect(t.avg_risk_change).toBe(20); // 40 - 20
    expect(t.at_risk_change).toBe(1); // 2 - 1
    expect(t.direction).toBe("up");
  });

  it("flat within the deadband; down when decreasing", () => {
    expect(buildDimensionTrend("x", [pt("a", 50), pt("b", 51)]).direction).toBe("flat");
    expect(buildDimensionTrend("x", [pt("a", 60), pt("b", 40)]).direction).toBe("down");
  });

  it("empty history → null current, zero deltas, flat", () => {
    const t = buildDimensionTrend("x", []);
    expect(t.current).toBeNull();
    expect(t.avg_risk_change).toBe(0);
    expect(t.direction).toBe("flat");
  });
});

describe("buildKpiScorecard", () => {
  it("computes value + change vs prior for the four KPIs", () => {
    const cur = pt("2026-07-10", 55, 4, 90, 10);
    const pri = pt("2026-07-01", 40, 2, 70, 8);
    const cards = buildKpiScorecard(cur, pri);
    const byKey = new Map(cards.map((c) => [c.key, c]));
    expect(byKey.get("total_assets")).toMatchObject({ value: 10, change: 2, direction: "up" });
    expect(byKey.get("at_risk_assets")).toMatchObject({ value: 4, change: 2, direction: "up" });
    expect(byKey.get("peak_risk")).toMatchObject({ value: 90, change: 20, direction: "up" });
    expect(byKey.get("average_risk")).toMatchObject({ value: 55, change: 15, direction: "up" });
  });

  it("no prior → zero change", () => {
    const cards = buildKpiScorecard(pt("d", 30, 1, 50, 5), null);
    expect(cards.every((c) => c.change === 0 && c.direction === "flat")).toBe(true);
  });

  it("null current → all zero", () => {
    expect(buildKpiScorecard(null, null).every((c) => c.value === 0)).toBe(true);
  });
});

describe("comparePoints", () => {
  it("returns per-metric deltas", () => {
    const cmp = comparePoints(pt("d", 50, 3, 80, 9), pt("e", 30, 1, 60, 7));
    const byMetric = new Map(cmp.map((c) => [c.metric, c]));
    expect(byMetric.get("avg_risk")).toMatchObject({ a: 50, b: 30, delta: 20 });
    expect(byMetric.get("asset_count")).toMatchObject({ delta: 2 });
  });
});

describe("historyToCsv", () => {
  it("emits a header + rows in fixed column order", () => {
    const csv = historyToCsv([{ dimension: "enterprise", ...pt("2026-07-01", 40, 2, 90, 10) }]);
    expect(csv.split("\n")[0]).toBe("dimension,snapshot_date,asset_count,at_risk_count,max_risk,avg_risk");
    expect(csv.split("\n")[1]).toBe("enterprise,2026-07-01,10,2,90,40");
  });

  it("escapes a dimension containing a comma", () => {
    const csv = historyToCsv([{ dimension: "a,b", ...pt("2026-07-01", 0) }]);
    expect(csv.split("\n")[1]!.startsWith('"a,b",')).toBe(true);
  });
});
