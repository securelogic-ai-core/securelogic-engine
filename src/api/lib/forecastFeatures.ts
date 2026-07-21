/**
 * forecastFeatures.ts — ERIP E5 (Predictive Intelligence): PURE feature
 * engineering that turns a dimension's risk_history rows into the numeric
 * series the forecast models fit. No I/O. Deterministic.
 *
 * Each forecastable metric (avg_risk, at_risk_count) becomes a
 * `SeriesPoint[]` with x = days since the window's first snapshot (so the
 * horizon is expressible in the same units) and y = the metric value.
 */

import type { SeriesPoint } from "./forecastModels.js";
import type { HistoryRow } from "./riskTrends.js";

export type ForecastMetric = "avg_risk" | "at_risk_count";
export const FORECAST_METRICS: readonly ForecastMetric[] = ["avg_risk", "at_risk_count"];

const MS_PER_DAY = 86_400_000;

/** Ordinal day index of a YYYY-MM-DD date relative to `origin`. */
function dayIndex(date: string, originMs: number): number {
  return Math.round((new Date(date).getTime() - originMs) / MS_PER_DAY);
}

/**
 * Build the (date-ascending) series for one metric from a dimension's history
 * rows. Rows must already be filtered to one dimension. Returns points + the
 * ordinal x of the last observation (the base for horizon projection).
 */
export function buildSeries(rows: readonly HistoryRow[], metric: ForecastMetric): { points: SeriesPoint[]; lastX: number } {
  if (rows.length === 0) return { points: [], lastX: 0 };
  const sorted = [...rows].sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : 0));
  const originMs = new Date(sorted[0]!.snapshot_date).getTime();
  const points = sorted.map((r) => ({ x: dayIndex(r.snapshot_date, originMs), y: r[metric] }));
  return { points, lastX: points[points.length - 1]!.x };
}

/** Group history rows by dimension (each list stays date-ascending). */
export function groupHistoryByDimension(rows: readonly HistoryRow[]): Map<string, HistoryRow[]> {
  const out = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const list = out.get(r.dimension) ?? [];
    list.push(r);
    out.set(r.dimension, list);
  }
  return out;
}
