/**
 * forecastEngine.ts — ERIP Epic 5 (Predictive Intelligence): a PURE,
 * deterministic, explainable forecaster (ERIP-AD-21). Ordinary least-squares
 * linear regression over an observed numeric series — no opaque ML. Every
 * result carries the fit (slope/intercept/R²), a sample-size- and fit-scaled
 * confidence, a factual trend label (ERIP-AD-23), and a reasoning trace. Given
 * the same points it returns the same output. No I/O.
 */

export interface ForecastPoint {
  x: number;
  y: number;
}

export type ForecastTrend = "increasing" | "decreasing" | "stable";

export interface ForecastResult {
  method: "ols_linear";
  sample_size: number;
  slope: number;
  intercept: number;
  r_squared: number;
  horizon_x: number;
  projected_value: number;
  trend: ForecastTrend;
  confidence: number;
  reasoning: string[];
  insufficient_data: boolean;
}

/** |predicted change| below this over the horizon reads as "stable". */
const STABLE_DEADBAND = 2;
/** Confidence reaches its fit-quality ceiling at this many samples. */
const CONFIDENCE_SAMPLE_TARGET = 6;

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Fit y ~ slope·x + intercept by OLS and project to `horizonX`. `clamp` bounds
 * the projected value (e.g. [0,100] for a bounded score). Degenerate inputs
 * (< 2 points or zero x-variance) return insufficient_data with a flat
 * projection at the last (or only) observed value.
 */
export function forecastLinear(
  points: readonly ForecastPoint[],
  horizonX: number,
  clamp?: { min: number; max: number }
): ForecastResult {
  const n = points.length;
  const clampVal = (v: number) => (clamp ? Math.max(clamp.min, Math.min(clamp.max, v)) : v);
  const last = points[n - 1];

  if (n < 2) {
    const flat = clampVal(last?.y ?? 0);
    return {
      method: "ols_linear",
      sample_size: n,
      slope: 0,
      intercept: flat,
      r_squared: 0,
      horizon_x: horizonX,
      projected_value: round(flat, 2),
      trend: "stable",
      confidence: 0,
      reasoning: ["Fewer than 2 data points — no trend can be fitted; projecting the last observed value flat."],
      insufficient_data: true
    };
  }

  const xbar = points.reduce((s, p) => s + p.x, 0) / n;
  const ybar = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - xbar) ** 2;
    sxy += (p.x - xbar) * (p.y - ybar);
    syy += (p.y - ybar) ** 2;
  }

  if (sxx === 0) {
    const flat = clampVal(ybar);
    return {
      method: "ols_linear",
      sample_size: n,
      slope: 0,
      intercept: round(flat, 2),
      r_squared: 0,
      horizon_x: horizonX,
      projected_value: round(flat, 2),
      trend: "stable",
      confidence: 0,
      reasoning: ["All samples share one x value — no slope is defined; projecting the mean flat."],
      insufficient_data: true
    };
  }

  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  const rSquared = syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));
  const rawProjection = slope * horizonX + intercept;
  const projected = clampVal(rawProjection);

  const predictedChange = slope * (horizonX - last!.x);
  const trend: ForecastTrend =
    Math.abs(predictedChange) < STABLE_DEADBAND ? "stable" : predictedChange > 0 ? "increasing" : "decreasing";

  const sampleFactor = Math.min(1, n / CONFIDENCE_SAMPLE_TARGET);
  const confidence = Math.round(100 * rSquared * sampleFactor);

  const reasoning = [
    `Fitted OLS linear regression over ${n} observations (x spanning ${round(points[0]!.x)}..${round(last!.x)}).`,
    `slope = ${round(slope, 4)} per x-unit; intercept = ${round(intercept, 2)}.`,
    `R² = ${round(rSquared, 3)} (fit quality); confidence scaled by sample size (${n}/${CONFIDENCE_SAMPLE_TARGET}).`,
    `Projected value at x=${round(horizonX)} = ${round(projected, 2)}${clamp && rawProjection !== projected ? " (clamped to bounds)" : ""}; trend ${trend}.`
  ];

  return {
    method: "ols_linear",
    sample_size: n,
    slope: round(slope, 6),
    intercept: round(intercept, 4),
    r_squared: round(rSquared, 4),
    horizon_x: horizonX,
    projected_value: round(projected, 2),
    trend,
    confidence,
    reasoning,
    insufficient_data: false
  };
}
