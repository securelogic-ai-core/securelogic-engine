/**
 * executiveRisk.ts — ERIP Executive Risk dashboard: client-safe types + PURE
 * presentation helpers for the risk / predictive / connector-health surfaces.
 * No React, no server imports, no env — so both the server API client
 * (lib/api.ts) and the "use client" chart components can share these types, and
 * the helpers are unit-testable in isolation.
 *
 * The engine endpoints these mirror (all dark behind their feature flags):
 *   GET /api/risk/trends, /api/risk/kpis            (riskIntelligence.ts)
 *   GET /api/predictive/insights, /predictive/posture-forecast (predictiveIntelligence.ts)
 *   GET /api/connectors/health                      (connectors.ts)
 */

// ── Risk trends / KPIs (E4) ────────────────────────────────────────────────

export interface HistoryPoint {
  snapshot_date: string; // YYYY-MM-DD
  asset_count: number;
  at_risk_count: number;
  max_risk: number;
  avg_risk: number;
}
export type TrendDirection = "up" | "down" | "flat";
export interface DimensionTrend {
  dimension: string;
  points: HistoryPoint[];
  current: HistoryPoint | null;
  avg_risk_change: number;
  at_risk_change: number;
  direction: TrendDirection;
}
export interface RiskTrendsResponse {
  window_days: number;
  trends: DimensionTrend[];
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  change: number;
  direction: TrendDirection;
}
export interface PeriodComparison {
  metric: string;
  a: number;
  b: number;
  delta: number;
}
export interface RiskKpisResponse {
  window_days: number;
  kpis: KpiCard[];
  comparison: PeriodComparison[];
}

// ── Predictive insights (E5) ───────────────────────────────────────────────

export interface Recommendation {
  dimension: string;
  action: string;
  priority: "immediate" | "near_term" | "planned" | "watch";
  rationale: string;
}
export interface PredictiveInsights {
  source: "llm" | "deterministic";
  headline: string;
  narrative: string;
  recommendations: Recommendation[];
}
export interface PredictiveInsightsResponse {
  horizon_days: number;
  insights: PredictiveInsights;
}

export interface ForecastPoint {
  x: number;
  y: number;
}
export interface PostureForecastResponse {
  metric: string;
  horizon_days: number;
  observations: Array<{ date: string; score: number | null }>;
  forecast: {
    method: string;
    trend: "increasing" | "decreasing" | "stable";
    points: ForecastPoint[];
    projected_value?: number;
  } | null;
}

// ── Connector health (E2c) ─────────────────────────────────────────────────

export type ConnectorHealthBand =
  | "healthy" | "degraded" | "failing" | "disabled" | "unconfigured" | "pending_first_sync";
export interface ConnectorHealthEntry {
  connector_id: string;
  display_name: string;
  category: string;
  band: ConnectorHealthBand;
  reasons: string[];
  severity: number;
  signals: {
    enabled: boolean;
    last_sync_status: string | null;
    last_sync_at: string | null;
    consecutive_failures: number;
    next_sync_at: string | null;
    stale_observations: number;
    writeback_pending: number;
    writeback_conflict: number;
    writeback_failed: number;
    open_dead_letters: number;
  };
}
export interface ConnectorHealthResponse {
  overall_band: ConnectorHealthBand;
  configured_count: number;
  by_band: Record<string, number>;
  connectors: ConnectorHealthEntry[];
}

// ── Pure presentation helpers ──────────────────────────────────────────────

export type RiskBand = "critical" | "high" | "moderate" | "low" | "none";

export interface BandMeta {
  band: RiskBand;
  label: string;
  color: string;
  text: string;
}

/** 0–100 risk score → factual band (mirrors graphImpactAnalysis on the engine). */
export function riskBand(score: number): RiskBand {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "moderate";
  if (score > 0) return "low";
  return "none";
}

const BAND_META: Record<RiskBand, BandMeta> = {
  critical: { band: "critical", label: "Critical", color: "#dc2626", text: "#fca5a5" },
  high: { band: "high", label: "High", color: "#ea580c", text: "#fdba74" },
  moderate: { band: "moderate", label: "Moderate", color: "#ca8a04", text: "#fde047" },
  low: { band: "low", label: "Low", color: "#0891b2", text: "#67e8f9" },
  none: { band: "none", label: "None", color: "#334155", text: "#94a3b8" }
};
export function riskBandMeta(score: number): BandMeta {
  return BAND_META[riskBand(score)];
}

/** Health band → { label, color, text } for the connector-health panel. */
const HEALTH_META: Record<ConnectorHealthBand, { label: string; color: string; text: string }> = {
  healthy: { label: "Healthy", color: "#16a34a", text: "#86efac" },
  degraded: { label: "Degraded", color: "#ca8a04", text: "#fde047" },
  failing: { label: "Failing", color: "#dc2626", text: "#fca5a5" },
  pending_first_sync: { label: "Pending first sync", color: "#0891b2", text: "#67e8f9" },
  disabled: { label: "Disabled", color: "#475569", text: "#94a3b8" },
  unconfigured: { label: "Not configured", color: "#334155", text: "#64748b" }
};
export function healthBandMeta(band: ConnectorHealthBand): { label: string; color: string; text: string } {
  return HEALTH_META[band] ?? HEALTH_META.unconfigured;
}

/** Human label for a dimension key ('enterprise' | asset_type). */
export function dimensionLabel(dimension: string): string {
  if (dimension === "enterprise") return "Enterprise";
  return dimension
    .split(/[_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Reason-code → readable phrase for the health panel. */
export function healthReasonLabel(code: string): string {
  const MAP: Record<string, string> = {
    dead_letters_open: "Open dead-letters",
    repeated_sync_failures: "Repeated sync failures",
    recent_sync_failure: "Recent sync failure",
    last_sync_failed: "Last sync failed",
    writeback_failures: "Writeback failures",
    writeback_conflicts: "Writeback conflicts",
    drift_stale_assets: "Drifted (stale) assets",
    sync_overdue: "Sync overdue",
    never_synced: "Never synced",
    connector_disabled: "Disabled"
  };
  return MAP[code] ?? code.replace(/_/g, " ");
}

export type DeltaTone = "good" | "bad" | "neutral";
export interface DeltaDisplay {
  text: string;
  arrow: string;
  tone: DeltaTone;
}

/**
 * Format a metric change for display. For risk metrics higher is WORSE, so an
 * increase is a "bad" tone; `total_assets` is neutral (growth ≠ risk).
 */
export function formatDelta(key: string, change: number): DeltaDisplay {
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "—";
  const text = change === 0 ? "No change" : `${change > 0 ? "+" : ""}${round1(change)}`;
  if (change === 0 || key === "total_assets") return { text, arrow, tone: "neutral" };
  const worseWhenUp = true; // every other KPI is a risk metric
  const isBad = worseWhenUp ? change > 0 : change < 0;
  return { text, arrow, tone: isBad ? "bad" : "good" };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Count dimensions whose avg_risk is trending up (executive summary stat). */
export function countRising(trends: readonly DimensionTrend[]): number {
  return trends.filter((t) => t.direction === "up").length;
}

/**
 * Build SVG polyline points for a series of numeric values scaled into a box.
 * Pure — the chart component supplies geometry. Values are clamped to [min,max].
 */
export function seriesToPoints(
  values: readonly number[],
  geom: { width: number; height: number; padX: number; padY: number; min?: number; max?: number }
): Array<{ x: number; y: number }> {
  const min = geom.min ?? 0;
  const max = geom.max ?? 100;
  const innerW = geom.width - geom.padX * 2;
  const innerH = geom.height - geom.padY * 2;
  const span = max - min || 1;
  const n = values.length;
  return values.map((v, i) => {
    const clamped = Math.max(min, Math.min(max, v));
    const x = n === 1 ? geom.padX + innerW / 2 : geom.padX + (i / (n - 1)) * innerW;
    const y = geom.padY + innerH - ((clamped - min) / span) * innerH;
    return { x, y };
  });
}

export function priorityMeta(priority: Recommendation["priority"]): { label: string; color: string } {
  const MAP: Record<Recommendation["priority"], { label: string; color: string }> = {
    immediate: { label: "Immediate", color: "#dc2626" },
    near_term: { label: "Near term", color: "#ea580c" },
    planned: { label: "Planned", color: "#ca8a04" },
    watch: { label: "Watch", color: "#0891b2" }
  };
  return MAP[priority] ?? { label: priority, color: "#334155" };
}
