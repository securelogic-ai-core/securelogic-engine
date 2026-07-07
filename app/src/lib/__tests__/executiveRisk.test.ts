import { describe, it, expect } from "vitest";
import {
  riskBand,
  riskBandMeta,
  healthBandMeta,
  dimensionLabel,
  healthReasonLabel,
  formatDelta,
  round1,
  countRising,
  seriesToPoints,
  priorityMeta,
  dimensionKpis,
  dimensionComparison,
  comparisonMetricLabel,
  type DimensionTrend,
  type HistoryPoint,
} from "../executiveRisk";

describe("riskBand", () => {
  it("maps scores to factual bands (matches the engine thresholds)", () => {
    expect(riskBand(85)).toBe("critical");
    expect(riskBand(80)).toBe("critical");
    expect(riskBand(60)).toBe("high");
    expect(riskBand(30)).toBe("moderate");
    expect(riskBand(1)).toBe("low");
    expect(riskBand(0)).toBe("none");
  });
  it("riskBandMeta returns a label + colors", () => {
    expect(riskBandMeta(90).label).toBe("Critical");
    expect(riskBandMeta(0).label).toBe("None");
  });
});

describe("healthBandMeta", () => {
  it("maps every band and falls back safely", () => {
    expect(healthBandMeta("healthy").label).toBe("Healthy");
    expect(healthBandMeta("failing").label).toBe("Failing");
    // Unknown band → unconfigured fallback.
    expect(healthBandMeta("bogus" as never).label).toBe("Not configured");
  });
});

describe("dimensionLabel", () => {
  it("special-cases enterprise and title-cases asset types", () => {
    expect(dimensionLabel("enterprise")).toBe("Enterprise");
    expect(dimensionLabel("cloud_resource")).toBe("Cloud Resource");
    expect(dimensionLabel("endpoint")).toBe("Endpoint");
  });
});

describe("healthReasonLabel", () => {
  it("humanizes known codes and degrades gracefully", () => {
    expect(healthReasonLabel("dead_letters_open")).toBe("Open dead-letters");
    expect(healthReasonLabel("some_unknown_code")).toBe("some unknown code");
  });
});

describe("formatDelta", () => {
  it("treats a risk increase as bad and a decrease as good", () => {
    expect(formatDelta("average_risk", 5).tone).toBe("bad");
    expect(formatDelta("average_risk", -5).tone).toBe("good");
  });
  it("treats asset growth as neutral", () => {
    expect(formatDelta("total_assets", 10).tone).toBe("neutral");
  });
  it("no change is neutral", () => {
    const d = formatDelta("average_risk", 0);
    expect(d.tone).toBe("neutral");
    expect(d.text).toBe("No change");
  });
  it("prefixes a sign for non-zero changes", () => {
    expect(formatDelta("peak_risk", 3).text).toBe("+3");
    expect(formatDelta("peak_risk", -3.28).text).toBe("-3.3");
  });
});

describe("round1", () => {
  it("rounds to one decimal", () => {
    expect(round1(3.14159)).toBe(3.1);
    expect(round1(10)).toBe(10);
  });
});

describe("countRising", () => {
  const t = (dimension: string, direction: DimensionTrend["direction"]): DimensionTrend => ({
    dimension, points: [], current: null, avg_risk_change: 0, at_risk_change: 0, direction,
  });
  it("counts dimensions trending up", () => {
    expect(countRising([t("a", "up"), t("b", "down"), t("c", "up"), t("d", "flat")])).toBe(2);
  });
});

describe("seriesToPoints", () => {
  const geom = { width: 100, height: 100, padX: 10, padY: 10, min: 0, max: 100 };
  it("centers a single point", () => {
    const pts = seriesToPoints([50], geom);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.x).toBe(50); // padX + innerW/2
  });
  it("spans first→last across the inner width and inverts y (higher = up)", () => {
    const pts = seriesToPoints([0, 100], geom);
    expect(pts[0]!.x).toBe(10); // padX
    expect(pts[1]!.x).toBe(90); // padX + innerW
    expect(pts[0]!.y).toBe(90); // value 0 → bottom
    expect(pts[1]!.y).toBe(10); // value 100 → top
  });
  it("clamps out-of-range values", () => {
    const pts = seriesToPoints([-20, 150], geom);
    expect(pts[0]!.y).toBe(90); // clamped to min → bottom
    expect(pts[1]!.y).toBe(10); // clamped to max → top
  });
});

describe("priorityMeta", () => {
  it("labels every priority", () => {
    expect(priorityMeta("immediate").label).toBe("Immediate");
    expect(priorityMeta("watch").label).toBe("Watch");
  });
});

const pt = (over: Partial<HistoryPoint>): HistoryPoint => ({
  snapshot_date: "2026-01-01", asset_count: 0, at_risk_count: 0, max_risk: 0, avg_risk: 0, ...over,
});
const trendWith = (points: HistoryPoint[]): DimensionTrend => ({
  dimension: "cloud_resource",
  points,
  current: points[points.length - 1] ?? null,
  avg_risk_change: 0,
  at_risk_change: 0,
  direction: "flat",
});

describe("dimensionKpis", () => {
  it("scores current vs window-start for ANY dimension (not just enterprise)", () => {
    const t = trendWith([
      pt({ snapshot_date: "2026-01-01", asset_count: 10, at_risk_count: 2, max_risk: 40, avg_risk: 20 }),
      pt({ snapshot_date: "2026-02-01", asset_count: 12, at_risk_count: 5, max_risk: 70, avg_risk: 35 }),
    ]);
    const kpis = dimensionKpis(t);
    const avg = kpis.find((k) => k.key === "average_risk")!;
    expect(avg.value).toBe(35);
    expect(avg.change).toBe(15); // 35 − 20
    expect(avg.direction).toBe("up");
    const atRisk = kpis.find((k) => k.key === "at_risk_assets")!;
    expect(atRisk.value).toBe(5);
    expect(atRisk.change).toBe(3);
  });
  it("zero change (single point) → flat, change 0", () => {
    const kpis = dimensionKpis(trendWith([pt({ avg_risk: 50, asset_count: 3 })]));
    expect(kpis.every((k) => k.change === 0)).toBe(true);
    expect(kpis.every((k) => k.direction === "flat")).toBe(true);
  });
});

describe("dimensionComparison", () => {
  it("returns per-metric window-start vs now deltas", () => {
    const t = trendWith([
      pt({ asset_count: 10, at_risk_count: 2, max_risk: 40, avg_risk: 20 }),
      pt({ asset_count: 12, at_risk_count: 5, max_risk: 70, avg_risk: 35 }),
    ]);
    const cmp = dimensionComparison(t);
    const avg = cmp.find((c) => c.metric === "avg_risk")!;
    expect(avg.a).toBe(35); // now
    expect(avg.b).toBe(20); // window start
    expect(avg.delta).toBe(15);
  });
  it("empty when < 2 points", () => {
    expect(dimensionComparison(trendWith([pt({})]))).toEqual([]);
    expect(dimensionComparison(trendWith([]))).toEqual([]);
  });
});

describe("comparisonMetricLabel", () => {
  it("labels known metrics and degrades", () => {
    expect(comparisonMetricLabel("avg_risk")).toBe("Average risk");
    expect(comparisonMetricLabel("at_risk_count")).toBe("Assets at risk");
    expect(comparisonMetricLabel("weird_metric")).toBe("weird metric");
  });
});
