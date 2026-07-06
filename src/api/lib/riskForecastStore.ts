/**
 * riskForecastStore.ts — ERIP E5 (Predictive Intelligence): compute + persist
 * risk forecasts (20260817). The pure `computeForecasts` fits OLS + Holt per
 * (dimension, metric) over the history window and keeps the winner; the store
 * upserts them per (org, dimension, metric, horizon). Re-running re-fits on the
 * latest window — the retraining step. Tenant-scoped (withTenant worker).
 */

import { pg } from "../infra/postgres.js";
import { readHistoryWindow } from "./riskHistoryStore.js";
import { computeForecasts, type ForecastRecord } from "./forecastCompute.js";

export type { ForecastRecord } from "./forecastCompute.js";

async function upsert(orgId: string, forecastDate: string, r: ForecastRecord): Promise<void> {
  await pg.query(
    `INSERT INTO risk_forecasts
       (organization_id, dimension, metric, horizon_days, method, projected_value, trend,
        confidence, in_sample_rmse, sample_size, reasoning, forecast_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
     ON CONFLICT (organization_id, dimension, metric, horizon_days)
     DO UPDATE SET
       method = EXCLUDED.method,
       projected_value = EXCLUDED.projected_value,
       trend = EXCLUDED.trend,
       confidence = EXCLUDED.confidence,
       in_sample_rmse = EXCLUDED.in_sample_rmse,
       sample_size = EXCLUDED.sample_size,
       reasoning = EXCLUDED.reasoning,
       forecast_date = EXCLUDED.forecast_date,
       updated_at = now()`,
    [
      orgId, r.dimension, r.metric, r.horizon_days, r.method, r.projected_value, r.trend,
      r.confidence, r.in_sample_rmse, r.sample_size, JSON.stringify(r.reasoning), forecastDate
    ]
  );
}

/**
 * Read the org's history window, fit forecasts, and upsert them. Returns the
 * number of forecast rows written. `historyDays` bounds the fit window;
 * `horizonDays` is how far ahead to project. Tenant-scoped.
 */
export async function computeAndPersistForecasts(
  orgId: string,
  forecastDate: string,
  opts: { historyDays: number; horizonDays: number }
): Promise<number> {
  const rows = await readHistoryWindow(orgId, opts.historyDays);
  const forecasts = computeForecasts(rows, opts.horizonDays);
  for (const f of forecasts) await upsert(orgId, forecastDate, f);
  return forecasts.length;
}

export interface StoredForecast extends ForecastRecord {
  forecast_date: string;
}

/** Read an org's current forecasts, optionally filtered to one dimension. */
export async function readForecasts(orgId: string, dimension?: string): Promise<StoredForecast[]> {
  const params: unknown[] = [orgId];
  let where = "organization_id = $1";
  if (dimension) {
    params.push(dimension);
    where += " AND dimension = $2";
  }
  const r = await pg.query<StoredForecast & { projected_value: string; in_sample_rmse: string }>(
    `SELECT dimension, metric, horizon_days, method,
            projected_value::float8 AS projected_value, trend, confidence,
            in_sample_rmse::float8 AS in_sample_rmse, sample_size, reasoning,
            forecast_date::text AS forecast_date
       FROM risk_forecasts
      WHERE ${where}
      ORDER BY dimension, metric`,
    params
  );
  return r.rows as unknown as StoredForecast[];
}
