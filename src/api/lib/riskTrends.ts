/**
 * riskTrends.ts — ERIP E4 (Executive Intelligence): PURE trend + KPI analysis
 * over the risk_history time series (F2). No I/O. Deterministic. Composes
 * canonical history points into executive trend lines, period-over-period
 * deltas, and scorecard KPIs (ERIP-AD-19 — compose, never store).
 */

export interface HistoryPoint {
  snapshot_date: string; // YYYY-MM-DD
  asset_count: number;
  at_risk_count: number;
  max_risk: number;
  avg_risk: number;
}

/** A history point tagged with its dimension (the shape rows are read as). */
export interface HistoryRow extends HistoryPoint {
  dimension: string;
}

export type TrendDirection = "up" | "down" | "flat";

export interface DimensionTrend {
  dimension: string;
  points: HistoryPoint[];
  /** Latest snapshot's values (null when there is no history). */
  current: HistoryPoint | null;
  /** Change in avg_risk from the first to the last point. */
  avg_risk_change: number;
  /** Change in at_risk_count from the first to the last point. */
  at_risk_change: number;
  /** Direction of the avg_risk change, with a small deadband. */
  direction: TrendDirection;
}

const FLAT_DEADBAND = 2;

function directionOf(delta: number): TrendDirection {
  if (Math.abs(delta) < FLAT_DEADBAND) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Build a dimension's trend from its (date-ascending) history points. */
export function buildDimensionTrend(dimension: string, points: readonly HistoryPoint[]): DimensionTrend {
  const sorted = [...points].sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : 0));
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const avgChange = first && last ? last.avg_risk - first.avg_risk : 0;
  const atRiskChange = first && last ? last.at_risk_count - first.at_risk_count : 0;
  return {
    dimension,
    points: sorted,
    current: last,
    avg_risk_change: avgChange,
    at_risk_change: atRiskChange,
    direction: directionOf(avgChange)
  };
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  /** Change vs the comparison period's value (0 when no prior period). */
  change: number;
  direction: TrendDirection;
}

/**
 * Executive KPI scorecard from the enterprise dimension's current vs a prior
 * comparison point. `prior` is the enterprise point at the start of the window
 * (or null). Higher risk = worse, so `at_risk`/`peak`/`avg` directions are
 * reported factually (up/down/flat) and the consuming surface colors them.
 */
export function buildKpiScorecard(current: HistoryPoint | null, prior: HistoryPoint | null): KpiCard[] {
  const cur = current ?? { snapshot_date: "", asset_count: 0, at_risk_count: 0, max_risk: 0, avg_risk: 0 };
  const pri = prior ?? cur;
  const card = (key: string, label: string, value: number, priorValue: number): KpiCard => {
    const change = value - priorValue;
    return { key, label, value, change, direction: directionOf(change) };
  };
  return [
    card("total_assets", "Total assets", cur.asset_count, pri.asset_count),
    card("at_risk_assets", "Assets at risk", cur.at_risk_count, pri.at_risk_count),
    card("peak_risk", "Peak risk", cur.max_risk, pri.max_risk),
    card("average_risk", "Average risk", cur.avg_risk, pri.avg_risk)
  ];
}

/**
 * Period-over-period comparison of two dimension trends' current points.
 * Returns per-metric deltas. Used by the comparison endpoint (e.g. this month
 * vs last month, or dimension A vs dimension B at the same date).
 */
export interface PeriodComparison {
  metric: string;
  a: number;
  b: number;
  delta: number;
}

export function comparePoints(a: HistoryPoint | null, b: HistoryPoint | null): PeriodComparison[] {
  const av = a ?? { snapshot_date: "", asset_count: 0, at_risk_count: 0, max_risk: 0, avg_risk: 0 };
  const bv = b ?? { snapshot_date: "", asset_count: 0, at_risk_count: 0, max_risk: 0, avg_risk: 0 };
  const row = (metric: string, x: number, y: number): PeriodComparison => ({ metric, a: x, b: y, delta: x - y });
  return [
    row("asset_count", av.asset_count, bv.asset_count),
    row("at_risk_count", av.at_risk_count, bv.at_risk_count),
    row("max_risk", av.max_risk, bv.max_risk),
    row("avg_risk", av.avg_risk, bv.avg_risk)
  ];
}

/** CSV export of history points (deterministic column order; RFC4180-safe). */
export function historyToCsv(rows: ReadonlyArray<HistoryPoint & { dimension: string }>): string {
  const header = "dimension,snapshot_date,asset_count,at_risk_count,max_risk,avg_risk";
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = rows.map((r) =>
    [esc(r.dimension), r.snapshot_date, r.asset_count, r.at_risk_count, r.max_risk, r.avg_risk].join(",")
  );
  return [header, ...lines].join("\n");
}
