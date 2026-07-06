/**
 * forecastModels.ts — ERIP E5 (Predictive Intelligence): PURE statistical
 * forecasting beyond the single OLS line. Adds Holt's linear (double
 * exponential smoothing) and a model-selection that fits BOTH OLS and Holt to
 * an observed series, scores each by in-sample RMSE, and returns the better
 * fit — deterministic, explainable, reproducible (ERIP-AD-21). No I/O.
 *
 * "Automatically improves as customer history accumulates" is structural here:
 * the models are re-fit on every scheduled run over the latest window, so more
 * and newer points tighten the fit and the confidence with no trained weights
 * to manage — the inference worker's re-fit IS the retraining step.
 */

import { forecastLinear, type ForecastTrend } from "./forecastEngine.js";

export interface SeriesPoint {
  x: number; // ordinal day index
  y: number;
}

export interface HoltFit {
  level: number;
  trend: number;
  alpha: number;
  beta: number;
  rmse: number;
  projected: number;
}

const STABLE_DEADBAND = 2;
const ALPHAS = [0.2, 0.5, 0.8];
const BETAS = [0.1, 0.3, 0.5];

function clampMaybe(v: number, clamp?: { min: number; max: number }): number {
  return clamp ? Math.max(clamp.min, Math.min(clamp.max, v)) : v;
}

/** One Holt pass for fixed (alpha, beta); returns in-sample RMSE + projection. */
function holtPass(ys: readonly number[], alpha: number, beta: number, horizonSteps: number): HoltFit {
  let level = ys[0]!;
  let trend = ys.length > 1 ? ys[1]! - ys[0]! : 0;
  let sse = 0;
  for (let t = 1; t < ys.length; t++) {
    const forecast = level + trend; // one-step-ahead
    const err = ys[t]! - forecast;
    sse += err * err;
    const prevLevel = level;
    level = alpha * ys[t]! + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const rmse = ys.length > 1 ? Math.sqrt(sse / (ys.length - 1)) : 0;
  return { level, trend, alpha, beta, rmse, projected: level + horizonSteps * trend };
}

/** Grid-search (alpha, beta) minimizing in-sample RMSE. Needs ≥ 2 points. */
export function holtLinear(points: readonly SeriesPoint[], horizonSteps: number): HoltFit | null {
  const ys = points.map((p) => p.y);
  if (ys.length < 2) return null;
  let best: HoltFit | null = null;
  for (const a of ALPHAS) {
    for (const b of BETAS) {
      const fit = holtPass(ys, a, b, horizonSteps);
      if (best === null || fit.rmse < best.rmse) best = fit;
    }
  }
  return best;
}

export interface ModelForecast {
  method: "ols_linear" | "holt_linear";
  sample_size: number;
  projected_value: number;
  trend: ForecastTrend;
  confidence: number;
  in_sample_rmse: number;
  reasoning: string[];
  insufficient_data: boolean;
}

/** OLS in-sample RMSE for the comparison (the engine reports R², not RMSE). */
function olsRmse(points: readonly SeriesPoint[], slope: number, intercept: number): number {
  if (points.length < 2) return 0;
  let sse = 0;
  for (const p of points) {
    const err = p.y - (slope * p.x + intercept);
    sse += err * err;
  }
  return Math.sqrt(sse / (points.length - 1));
}

/**
 * Fit OLS and Holt, pick the lower in-sample RMSE, and return a unified,
 * explainable forecast. `horizonX` is the ordinal x to project to; the Holt
 * horizon-in-steps is derived from the last point's x. Confidence blends the
 * chosen model's fit quality with a sample-size factor. `clamp` bounds the
 * projected value (e.g. [0,100] for a score).
 */
export function selectForecast(
  points: readonly SeriesPoint[],
  horizonX: number,
  clamp?: { min: number; max: number }
): ModelForecast {
  const n = points.length;
  if (n < 2) {
    const flat = clampMaybe(points[n - 1]?.y ?? 0, clamp);
    return {
      method: "ols_linear",
      sample_size: n,
      projected_value: Math.round(flat * 100) / 100,
      trend: "stable",
      confidence: 0,
      in_sample_rmse: 0,
      reasoning: ["Fewer than 2 observations — projecting the last value flat."],
      insufficient_data: true
    };
  }

  const ols = forecastLinear(
    points.map((p) => ({ x: p.x, y: p.y })),
    horizonX,
    clamp
  );
  const olsErr = olsRmse(points, ols.slope, ols.intercept);

  const lastX = points[n - 1]!.x;
  const horizonSteps = Math.max(0, Math.round(horizonX - lastX));
  const holt = holtLinear(points, horizonSteps);

  // Sample-size factor rewards more history (the "improves as data accumulates" law).
  const sampleFactor = Math.min(1, n / 8);
  // Normalize RMSE against the observed range so confidence is scale-free.
  const ys = points.map((p) => p.y);
  const range = Math.max(1, Math.max(...ys) - Math.min(...ys));

  const useHolt = holt !== null && holt.rmse < olsErr;
  if (useHolt && holt) {
    const projected = clampMaybe(holt.projected, clamp);
    const predictedChange = holt.projected - points[n - 1]!.y;
    const trend: ForecastTrend =
      Math.abs(predictedChange) < STABLE_DEADBAND ? "stable" : predictedChange > 0 ? "increasing" : "decreasing";
    const fitQuality = Math.max(0, 1 - holt.rmse / range);
    return {
      method: "holt_linear",
      sample_size: n,
      projected_value: Math.round(projected * 100) / 100,
      trend,
      confidence: Math.round(100 * fitQuality * sampleFactor),
      in_sample_rmse: Math.round(holt.rmse * 100) / 100,
      reasoning: [
        `Holt double-exponential smoothing chosen (in-sample RMSE ${holt.rmse.toFixed(2)} < OLS ${olsErr.toFixed(2)}).`,
        `alpha=${holt.alpha}, beta=${holt.beta}; level=${holt.level.toFixed(2)}, trend=${holt.trend.toFixed(3)}/step.`,
        `Projected ${projected.toFixed(2)} at horizon (${horizonSteps} steps); confidence scaled by fit quality and ${n}/8 sample size.`
      ],
      insufficient_data: false
    };
  }

  // OLS wins (or Holt unavailable). Re-express its confidence in the same units.
  const olsFitQuality = Math.max(0, 1 - olsErr / range);
  return {
    method: "ols_linear",
    sample_size: n,
    projected_value: ols.projected_value,
    trend: ols.trend,
    confidence: Math.round(100 * olsFitQuality * sampleFactor),
    in_sample_rmse: Math.round(olsErr * 100) / 100,
    reasoning: [
      `OLS linear chosen (in-sample RMSE ${olsErr.toFixed(2)} ≤ Holt ${holt ? holt.rmse.toFixed(2) : "n/a"}).`,
      ...ols.reasoning
    ],
    insufficient_data: false
  };
}
