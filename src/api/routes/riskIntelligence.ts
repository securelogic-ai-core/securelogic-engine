/**
 * riskIntelligence.ts — ERIP Epic 3: the executive risk-intelligence read
 * surface (dimensional rollups). Derived and read-only (ERIP-AD-15): every
 * number rolls up per-asset own-risk from the org's CURRENT applicability
 * decisions (ERIP-AD-16) over the federated `asset_registry_v` — no new stored
 * risk truth.
 *
 * Route chain: the Risk Intelligence flag FIRST (404 while dark), then the
 * asset-registry flag (it reads the registry view), auth, org context, the
 * per-org `enterprise_context` capability, and asTenant. Every query filters
 * `organization_id = $1` inside the tenant transaction.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { requireCapability as requireSeatCapability } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { riskIntelligenceFeatureFlag } from "../lib/riskIntelligenceFeatureFlag.js";
import { rollupRiskByDimension } from "../lib/riskDimensionRollup.js";
import { composeExecutiveRiskSummary, type PostureContext } from "../lib/executiveRiskSummary.js";
import { gatherAssetRisk } from "../lib/riskDimensionData.js";
import { readHistoryWindow, ENTERPRISE_DIMENSION, type HistoryRow } from "../lib/riskHistoryStore.js";
import { toDisplayScore } from "../lib/postureDisplay.js";
import {
  buildDimensionTrend,
  buildKpiScorecard,
  comparePoints,
  historyToCsv,
  type HistoryPoint
} from "../lib/riskTrends.js";

const router = Router();

const DEFAULT_TREND_DAYS = 30;
const MAX_TREND_DAYS = 365;
const TREND_INT_RE = /^\d+$/;

/** Parse a bounded ?days window; null on invalid. */
function parseDays(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_TREND_DAYS;
  if (typeof raw !== "string" || !TREND_INT_RE.test(raw)) return null;
  const n = Number(raw);
  if (n < 1 || n > MAX_TREND_DAYS) return null;
  return n;
}

/** Group history rows by dimension (preserving date-ascending order). */
function groupByDimension(rows: readonly HistoryRow[]): Map<string, HistoryPoint[]> {
  const out = new Map<string, HistoryPoint[]>();
  for (const r of rows) {
    const list = out.get(r.dimension) ?? [];
    list.push({
      snapshot_date: r.snapshot_date,
      asset_count: r.asset_count,
      at_risk_count: r.at_risk_count,
      max_risk: r.max_risk,
      avg_risk: r.avg_risk
    });
    out.set(r.dimension, list);
  }
  return out;
}

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

export async function getRiskDimensions(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const riskRows = await gatherAssetRisk(orgId);
  res.status(200).json({ risk: rollupRiskByDimension(riskRows) });
}

/** ERIP Epic 4: board-ready executive risk summary (compose canonical objects). */
export async function getExecutiveRiskSummary(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const rollup = rollupRiskByDimension(await gatherAssetRisk(orgId));

  // Latest posture snapshot (as-is; null when the org has none yet).
  const snap = await pg.query<{ overall_score: number | null; overall_severity: string | null; snapshot_date: string | null }>(
    `SELECT overall_score, overall_severity, snapshot_date
       FROM posture_snapshots
      WHERE organization_id = $1
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [orgId]
  );
  const posture: PostureContext | null = snap.rows[0]
    ? {
        // Health-style display value (walkthrough ruling).
        overall_score: toDisplayScore(snap.rows[0].overall_score),
        overall_severity: snap.rows[0].overall_severity,
        snapshot_date: snap.rows[0].snapshot_date
      }
    : null;

  res.status(200).json({ executive_summary: composeExecutiveRiskSummary(rollup, posture) });
}

/** ERIP E4: per-dimension executive trend lines over the risk_history series. */
export async function getRiskTrends(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const days = parseDays(req.query.days);
  if (days === null) {
    res.status(400).json({ error: "invalid_days" });
    return;
  }
  const grouped = groupByDimension(await readHistoryWindow(orgId, days));
  const trends = [...grouped.entries()]
    .map(([dimension, points]) => buildDimensionTrend(dimension, points))
    // Enterprise first, then by current peak risk desc.
    .sort((a, b) => {
      if (a.dimension === ENTERPRISE_DIMENSION) return -1;
      if (b.dimension === ENTERPRISE_DIMENSION) return 1;
      return (b.current?.max_risk ?? 0) - (a.current?.max_risk ?? 0);
    });
  res.status(200).json({ window_days: days, trends });
}

/** ERIP E4: executive KPI scorecard (enterprise current vs window-start point). */
export async function getRiskKpis(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const days = parseDays(req.query.days);
  if (days === null) {
    res.status(400).json({ error: "invalid_days" });
    return;
  }
  const enterprise = groupByDimension(await readHistoryWindow(orgId, days)).get(ENTERPRISE_DIMENSION) ?? [];
  const current = enterprise[enterprise.length - 1] ?? null;
  const prior = enterprise.length > 1 ? enterprise[0]! : null;
  res.status(200).json({
    window_days: days,
    kpis: buildKpiScorecard(current, prior),
    comparison: comparePoints(current, prior)
  });
}

/** ERIP E4: CSV/JSON export of the risk history window (all dimensions). */
export async function exportRiskHistory(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const days = parseDays(req.query.days);
  if (days === null) {
    res.status(400).json({ error: "invalid_days" });
    return;
  }
  const format = typeof req.query.format === "string" ? req.query.format : "json";
  if (format !== "json" && format !== "csv") {
    res.status(400).json({ error: "invalid_format" });
    return;
  }
  const rows = await readHistoryWindow(orgId, days);
  if (format === "csv") {
    res.status(200).type("text/csv").send(historyToCsv(rows));
    return;
  }
  res.status(200).json({ window_days: days, rows });
}

const chain = [
  riskIntelligenceFeatureFlag,
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/risk/dimensions", ...chain, asTenant(getRiskDimensions));
router.get("/risk/trends", ...chain, asTenant(getRiskTrends));
router.get("/risk/kpis", ...chain, asTenant(getRiskKpis));
// Bulk export is separately permissioned: Viewers export only when the org
// grants it; Contributors never. Inert when the seat model is off.
router.get("/risk/export", ...chain, requireSeatCapability("export:data"), asTenant(exportRiskHistory));
router.get("/executive/risk-summary", ...chain, asTenant(getExecutiveRiskSummary));

export default router;
