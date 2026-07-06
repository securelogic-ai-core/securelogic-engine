/**
 * forecastCompute.ts — ERIP E5: the PURE forecast computation (no I/O). Fits
 * OLS + Holt per (dimension, metric) over a history window and keeps the
 * winner. Kept pg-free (unlike riskForecastStore) so it's unit-testable without
 * a database — the dataRightsWorkerPolicy split precedent.
 */

import { selectForecast, type ModelForecast } from "./forecastModels.js";
import { buildSeries, groupHistoryByDimension, FORECAST_METRICS, type ForecastMetric } from "./forecastFeatures.js";
import type { HistoryRow } from "./riskTrends.js";

export interface ForecastRecord {
  dimension: string;
  metric: ForecastMetric;
  horizon_days: number;
  method: ModelForecast["method"];
  projected_value: number;
  trend: ModelForecast["trend"];
  confidence: number;
  in_sample_rmse: number;
  sample_size: number;
  reasoning: string[];
}

const CLAMP: Record<ForecastMetric, { min: number; max: number }> = {
  avg_risk: { min: 0, max: 100 },
  at_risk_count: { min: 0, max: 1_000_000 }
};

/**
 * Fit a forecast for every (dimension, metric) with ≥ 2 history points over the
 * window. Dimensions/metrics with insufficient data are skipped. Deterministic.
 */
export function computeForecasts(rows: readonly HistoryRow[], horizonDays: number): ForecastRecord[] {
  const out: ForecastRecord[] = [];
  for (const [dimension, dimRows] of groupHistoryByDimension(rows)) {
    for (const metric of FORECAST_METRICS) {
      const { points, lastX } = buildSeries(dimRows, metric);
      if (points.length < 2) continue;
      const f = selectForecast(points, lastX + horizonDays, CLAMP[metric]);
      if (f.insufficient_data) continue;
      out.push({
        dimension,
        metric,
        horizon_days: horizonDays,
        method: f.method,
        projected_value: f.projected_value,
        trend: f.trend,
        confidence: f.confidence,
        in_sample_rmse: f.in_sample_rmse,
        sample_size: f.sample_size,
        reasoning: f.reasoning
      });
    }
  }
  return out;
}
