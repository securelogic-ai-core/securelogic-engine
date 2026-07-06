# ERIP Epic 5 — Predictive Intelligence (design memo)

Status: RATIFIED (ERIP autonomous-decision authority).
Roadmap: `enterprise-risk-intelligence-platform.md` §4 Epic 5.
Foundation reused: `posture_snapshots` history (real time series), the
explainability discipline from `engine/applicability/v1`. Additive, dark.

## Decisions (ERIP-AD-21 …)

> **ERIP-AD-21 — Forecasts are DETERMINISTIC, EXPLAINABLE, and REPRODUCIBLE.**
> No opaque ML. The engine is ordinary least-squares linear regression over an
> observed numeric series; every forecast carries the input points, the fitted
> slope/intercept, the method, and a confidence derived from fit quality (R²)
> and sample size. Given the same inputs it returns the same output (the WORM
> discipline, applied to prediction).

> **ERIP-AD-22 — Predict only where a real series exists.** Posture score history
> (`posture_snapshots`) is a genuine time series and is the first forecast
> target. The other roadmap prediction families (vendor deterioration, SLA
> failure, audit readiness, control degradation) reuse the SAME pure engine over
> THEIR series — delivered as those series accrue, not fabricated from absent
> data. The engine is the deliverable; each series is a thin adapter.

> **ERIP-AD-23 — Direction is stated factually, never interpreted as good/bad.**
> The forecast reports `increasing` / `decreasing` / `stable` on the raw metric
> plus the projected value and confidence. Whether "increasing" is good depends
> on the metric's polarity — that judgement belongs to the consuming surface,
> not the forecaster.

## Phases

### E5.P1 — deterministic forecast engine + posture forecast (this epic's core)
- `forecastEngine.ts` (PURE): OLS over (x, y) points → { slope, intercept,
  projected_value at a horizon, trend (increasing/decreasing/stable via a slope
  deadband), confidence 0–100 from R² × sample-size factor, reasoning trace }.
  Deterministic; guards degenerate inputs (< 2 points, zero variance).
- `GET /api/predictive/posture-forecast?horizon_days=N` (new flag
  `SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED` + registry chain): read the
  org's posture-snapshot series, forecast the overall score, return the
  projection + the explainable trace + the points used. Read-only; no migration.

### Deferred (by ruling, tracker)
- Vendor-deterioration / SLA / audit-readiness / control-degradation forecasts —
  same engine, their own series, as those series accrue.
- Recommendation emission into `actions` (suggest-only) — after the forecast
  surfaces prove out.

## Exit
An org with posture history gets a reproducible, explained numeric forecast of
its overall posture at a chosen horizon, with confidence bounded by fit quality
and sample size — the deterministic-forecasting substrate the other prediction
families reuse.
