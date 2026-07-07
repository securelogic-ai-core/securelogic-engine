/**
 * eventHistorySeries.ts — predictive intelligence over canonical event history.
 * Intelligence Pipeline Hardening (item 6).
 *
 * Builds a daily time series from the canonical event TIMELINE (first_seen,
 * exploit_activity, …) and forecasts it with the shared deterministic OLS engine.
 * Because the series counts EVENTS (deduplicated) rather than raw cyber_signals,
 * repeated signals for the same CVE do NOT create duplicate spikes — the core
 * requirement of item 6. Reads are GLOBAL (elevated); the series builder is pure.
 */

import { pgElevated } from "../../infra/postgres.js";
import { forecastLinear, type ForecastPoint, type ForecastResult } from "../forecastEngine.js";

/** Timeline entry types that make sensible activity series. */
export const FORECASTABLE_ENTRY_TYPES = new Set([
  "first_seen",
  "corroborated",
  "exploit_activity",
  "patch_available",
  "severity_change",
  "status_change"
]);

export interface DailyCount {
  readonly day: string; // YYYY-MM-DD (UTC)
  readonly count: number;
}

/** Convert a date-ascending daily series to ForecastPoints (x = days since first). */
export function toForecastPoints(rows: readonly DailyCount[]): ForecastPoint[] {
  if (rows.length === 0) return [];
  const first = Date.parse(`${rows[0]!.day}T00:00:00Z`);
  return rows.map((r) => ({
    x: (Date.parse(`${r.day}T00:00:00Z`) - first) / 86_400_000,
    y: r.count
  }));
}

function boundDays(raw: number, max: number, def: number): number {
  if (!Number.isFinite(raw)) return def;
  return Math.min(max, Math.max(1, Math.floor(raw)));
}

/** Fetch the daily count of a timeline entry type over a trailing window. */
export async function fetchEventActivitySeries(
  entryType: string,
  windowDays = 90
): Promise<DailyCount[]> {
  const days = boundDays(windowDays, 365, 90);
  const res = await pgElevated.query<{ day: string; count: number }>(
    `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
       FROM intelligence_event_timeline
      WHERE entry_type = $1
        AND occurred_at >= NOW() - ($2 || ' days')::interval
      GROUP BY 1
      ORDER BY 1 ASC`,
    [entryType, String(days)]
  );
  return res.rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

export interface EventActivityForecast {
  readonly entry_type: string;
  readonly window_days: number;
  readonly horizon_days: number;
  readonly series: DailyCount[];
  readonly forecast: ForecastResult;
}

/**
 * Forecast future activity for a timeline entry type from its event-level daily
 * series. Deterministic; counts are never bounded (clamp min 0 only).
 */
export async function forecastEventActivity(
  entryType: string,
  windowDays = 90,
  horizonDays = 14
): Promise<EventActivityForecast> {
  const window = boundDays(windowDays, 365, 90);
  const horizon = boundDays(horizonDays, 180, 14);
  const series = await fetchEventActivitySeries(entryType, window);
  const points = toForecastPoints(series);
  const lastX = points.length > 0 ? points[points.length - 1]!.x : 0;
  const forecast = forecastLinear(points, lastX + horizon, { min: 0, max: Number.MAX_SAFE_INTEGER });
  return { entry_type: entryType, window_days: window, horizon_days: horizon, series, forecast };
}
