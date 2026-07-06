/**
 * predictiveForecastWorker.ts — ERIP E5 (Predictive Intelligence): the daily
 * inference / retraining worker. For every org it re-fits OLS + Holt on the
 * latest risk-history window and upserts the forecasts (ERIP-AD-21). The re-fit
 * IS the retraining — models sharpen as history accumulates, no trained weights
 * to manage.
 *
 * Registered always; each tick self-gates on the Predictive flag AND the
 * asset-registry flag (the history it reads is a registry rollup) — zero DB
 * access while either is off. Cross-org fan-out over the elevated channel; each
 * org runs inside its own withTenant transaction; never throws.
 */

import { schedule } from "node-cron";

import { pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { predictiveIntelligenceEnabled } from "../lib/predictiveIntelligenceFeatureFlag.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { computeAndPersistForecasts } from "../lib/riskForecastStore.js";

/** Fit window and projection horizon (days). */
export const FORECAST_HISTORY_DAYS = 180;
export const FORECAST_HORIZON_DAYS = 30;

export interface PredictiveWorkerDeps {
  today?: () => string;
  shouldContinue?: () => boolean;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Re-fit and persist forecasts for every organization. Never throws — a per-org
 * failure is logged and the sweep continues. Returns the number of orgs
 * forecasted (those that produced ≥ 1 forecast).
 */
export async function runForecastInference(deps: PredictiveWorkerDeps = {}): Promise<number> {
  if (!predictiveIntelligenceEnabled() || !assetRegistryEnabled()) return 0;
  const date = (deps.today ?? todayUtc)();

  const orgs = await pgElevated.query<{ id: string }>(`SELECT id FROM organizations`);
  let forecasted = 0;
  for (const org of orgs.rows) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    try {
      const n = await withTenant(org.id, () =>
        computeAndPersistForecasts(org.id, date, {
          historyDays: FORECAST_HISTORY_DAYS,
          horizonDays: FORECAST_HORIZON_DAYS
        })
      );
      if (n > 0) forecasted += 1;
    } catch (err) {
      logger.error(
        { event: "forecast_inference_org_failed", org_id: org.id, date, err },
        "forecast inference failed for one org; continuing"
      );
    }
  }
  if (orgs.rows.length > 0) {
    logger.info(
      { event: "forecast_inference_complete", date, orgs: orgs.rows.length, forecasted },
      "predictive forecast inference complete"
    );
  }
  return forecasted;
}

let isInferring = false;

/**
 * Register the daily inference cron (03:45 UTC — after the risk-history
 * snapshot at 03:15 so forecasts fit the freshest point). Always registered;
 * self-gates inside the run on both flags.
 */
export function startPredictiveForecastWorker(): void {
  schedule("45 3 * * *", () => {
    if (isInferring) {
      logger.warn({ event: "forecast_inference_overlap_skipped" }, "predictive worker: previous run still going");
      return;
    }
    isInferring = true;
    void runForecastInference()
      .catch((err) => logger.error({ event: "forecast_inference_tick_error", err }, "predictive worker tick failed"))
      .finally(() => {
        isInferring = false;
      });
  });
  logger.info(
    { event: "predictive_forecast_worker_registered", schedule: "45 3 * * * (daily 03:45 UTC)" },
    "Predictive forecast worker registered (gated by SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED + SECURELOGIC_ASSET_REGISTRY_ENABLED)"
  );
}
