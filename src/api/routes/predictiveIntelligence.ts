/**
 * predictiveIntelligence.ts — ERIP Epic 5: the forecast read surface. Derived,
 * read-only, deterministic (ERIP-AD-21): forecasts are computed on read from an
 * existing canonical time series (posture snapshots) — no new stored truth.
 *
 * Route chain: the Predictive flag FIRST (404 while dark), then auth, org
 * context, the per-org `enterprise_context` capability, and asTenant. Every
 * query filters `organization_id = $1`.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { predictiveIntelligenceFeatureFlag } from "../lib/predictiveIntelligenceFeatureFlag.js";
import { forecastLinear, type ForecastPoint } from "../lib/forecastEngine.js";
import { readForecasts } from "../lib/riskForecastStore.js";
import { FORECAST_HORIZON_DAYS } from "../workers/predictiveForecastWorker.js";
import { generatePredictiveInsights } from "../lib/predictiveNarrative.js";

const router = Router();

const DEFAULT_HORIZON_DAYS = 30;
const MAX_HORIZON_DAYS = 365;
const INTEGER_RE = /^-?\d+$/;

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

const MS_PER_DAY = 86_400_000;

export async function getPostureForecast(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const raw = req.query.horizon_days;
  let horizonDays = DEFAULT_HORIZON_DAYS;
  if (raw !== undefined) {
    if (typeof raw !== "string" || !INTEGER_RE.test(raw)) {
      res.status(400).json({ error: "invalid_horizon_days" });
      return;
    }
    horizonDays = Number(raw);
    if (horizonDays < 1 || horizonDays > MAX_HORIZON_DAYS) {
      res.status(400).json({ error: "invalid_horizon_days" });
      return;
    }
  }

  // The org's posture-score time series (scored snapshots only, oldest first).
  const { rows } = await pg.query<{ snapshot_date: string; overall_score: number }>(
    `SELECT snapshot_date, overall_score
       FROM posture_snapshots
      WHERE organization_id = $1 AND overall_score IS NOT NULL
      ORDER BY snapshot_date ASC`,
    [orgId]
  );

  // x = days since the first snapshot; y = overall score (bounded 0–100).
  const first = rows.length > 0 ? new Date(rows[0]!.snapshot_date).getTime() : 0;
  const points: ForecastPoint[] = rows.map((r) => ({
    x: (new Date(r.snapshot_date).getTime() - first) / MS_PER_DAY,
    y: r.overall_score
  }));
  const lastX = points.length > 0 ? points[points.length - 1]!.x : 0;
  const forecast = forecastLinear(points, lastX + horizonDays, { min: 0, max: 100 });

  res.status(200).json({
    metric: "posture_overall_score",
    horizon_days: horizonDays,
    observations: rows.map((r) => ({ date: r.snapshot_date, score: r.overall_score })),
    forecast
  });
}

/** ERIP E5: read the org's persisted risk forecasts (all dimensions). */
export async function getRiskForecasts(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  res.status(200).json({
    horizon_days: FORECAST_HORIZON_DAYS,
    forecasts: await readForecasts(orgId)
  });
}

/** ERIP E5: read the org's persisted forecasts for one dimension. */
export async function getRiskForecastForDimension(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const dimension = req.params.dimension;
  if (typeof dimension !== "string" || dimension.length === 0 || dimension.length > 64) {
    res.status(400).json({ error: "invalid_dimension" });
    return;
  }
  const forecasts = await readForecasts(orgId, dimension);
  res.status(200).json({ dimension, horizon_days: FORECAST_HORIZON_DAYS, forecasts });
}

const chain = [
  predictiveIntelligenceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

/**
 * ERIP E5b: LLM-assisted executive predictive insights over the org's
 * forecasts. LLM-assisted when ANTHROPIC_API_KEY is set; otherwise the
 * deterministic narrative. Always grounded in the persisted forecasts.
 */
export async function getPredictiveInsights(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const forecasts = await readForecasts(orgId);
  const insights = await generatePredictiveInsights(forecasts);
  res.status(200).json({ horizon_days: FORECAST_HORIZON_DAYS, insights });
}

router.get("/predictive/posture-forecast", ...chain, asTenant(getPostureForecast));
router.get("/predictive/forecasts", ...chain, asTenant(getRiskForecasts));
router.get("/predictive/forecasts/:dimension", ...chain, asTenant(getRiskForecastForDimension));
router.get("/predictive/insights", ...chain, asTenant(getPredictiveInsights));

export default router;
