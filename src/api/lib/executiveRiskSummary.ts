/**
 * executiveRiskSummary.ts — ERIP Epic 4 (Executive Intelligence): PURE
 * composition of canonical objects into a board-ready risk payload
 * (ERIP-AD-19 — compose, never store/redefine). No I/O.
 *
 * Combines the Epic-3 dimensional risk rollup with the org's latest posture
 * snapshot into: a headline (overall band + inventory + top risk dimensions),
 * a risk heatmap (asset_type × band), and posture context. Every number is
 * traceable to applicability decisions, the registry, and posture snapshots.
 * Time-series trends are deliberately absent (ERIP-AD-20 — no persisted risk
 * history to source them honestly).
 */

import { riskBand, type RiskRollupResult, type RiskBand } from "./riskDimensionRollup.js";

export interface PostureContext {
  overall_score: number | null;
  overall_severity: string | null;
  snapshot_date: string | null;
}

export interface ExecutiveRiskSummary {
  headline: {
    overall_risk_band: RiskBand;
    peak_risk: number;
    average_risk: number;
    total_assets: number;
    at_risk_assets: number;
    top_dimensions: Array<{ dimension: string; max_risk: number; at_risk_count: number }>;
  };
  heatmap: Array<{ dimension: string; bands: Record<RiskBand, number> }>;
  posture: PostureContext | null;
}

/**
 * Compose the executive summary. `posture` is null when the org has no posture
 * snapshot yet (surfaced as "insufficient data" at the presentation layer).
 */
export function composeExecutiveRiskSummary(
  rollup: RiskRollupResult,
  posture: PostureContext | null
): ExecutiveRiskSummary {
  const top_dimensions = rollup.by_asset_type
    .filter((d) => d.at_risk_count > 0)
    .slice(0, 3)
    .map((d) => ({ dimension: d.dimension, max_risk: d.max_risk, at_risk_count: d.at_risk_count }));

  return {
    headline: {
      // Executive framing: the enterprise band reflects its worst-case asset.
      overall_risk_band: riskBand(rollup.overall.max_risk),
      peak_risk: rollup.overall.max_risk,
      average_risk: rollup.overall.avg_risk,
      total_assets: rollup.overall.asset_count,
      at_risk_assets: rollup.overall.at_risk_count,
      top_dimensions
    },
    heatmap: rollup.by_asset_type.map((d) => ({ dimension: d.dimension, bands: d.bands })),
    posture
  };
}
