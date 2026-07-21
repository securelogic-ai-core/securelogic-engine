/**
 * riskDimensionRollup.ts — ERIP Epic 3 (E3 dimensional reporting): PURE
 * aggregation of per-asset own-risk into executive dimensions (ERIP-AD-15 —
 * derived, never a stored truth). No I/O; deterministic.
 *
 * Own-risk per asset is the applicability-derived seed (ERIP-AD-16). This
 * module buckets those seeds by asset_type (the primary executive dimension)
 * and reports, per dimension: asset count, how many are at risk, the peak and
 * mean risk, and a Critical/High/Moderate/Low/None band distribution.
 */

/** One asset's dimension inputs + its own-risk seed [0–100]. */
export interface AssetRiskRow {
  asset_type: string;
  criticality: string | null;
  own_risk: number;
}

export type RiskBand = "critical" | "high" | "moderate" | "low" | "none";

export interface DimensionRollup {
  dimension: string;
  asset_count: number;
  at_risk_count: number;
  max_risk: number;
  avg_risk: number;
  bands: Record<RiskBand, number>;
}

export interface RiskRollupResult {
  overall: DimensionRollup;
  by_asset_type: DimensionRollup[];
}

/** Map an own-risk score to a canonical band (SecureLogic severity vocabulary). */
export function riskBand(score: number): RiskBand {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "moderate";
  if (score > 0) return "low";
  return "none";
}

function emptyBands(): Record<RiskBand, number> {
  return { critical: 0, high: 0, moderate: 0, low: 0, none: 0 };
}

function rollup(dimension: string, rows: readonly AssetRiskRow[]): DimensionRollup {
  const bands = emptyBands();
  let sum = 0;
  let max = 0;
  let atRisk = 0;
  for (const r of rows) {
    const s = Math.max(0, Math.min(100, Math.round(r.own_risk)));
    bands[riskBand(s)] += 1;
    sum += s;
    if (s > max) max = s;
    if (s > 0) atRisk += 1;
  }
  return {
    dimension,
    asset_count: rows.length,
    at_risk_count: atRisk,
    max_risk: max,
    avg_risk: rows.length > 0 ? Math.round(sum / rows.length) : 0,
    bands
  };
}

/** Aggregate rows into an overall rollup + a per-asset_type breakdown (sorted). */
export function rollupRiskByDimension(rows: readonly AssetRiskRow[]): RiskRollupResult {
  const byType = new Map<string, AssetRiskRow[]>();
  for (const r of rows) {
    const list = byType.get(r.asset_type) ?? [];
    list.push(r);
    byType.set(r.asset_type, list);
  }
  const by_asset_type = [...byType.entries()]
    .map(([type, list]) => rollup(type, list))
    // Highest peak risk first, then most assets, then name — stable executive ordering.
    .sort((a, b) => b.max_risk - a.max_risk || b.asset_count - a.asset_count || (a.dimension < b.dimension ? -1 : 1));

  return { overall: rollup("enterprise", rows), by_asset_type };
}
