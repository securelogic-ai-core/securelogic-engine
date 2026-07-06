"use client";

/**
 * RiskTrendChart.tsx — interactive per-dimension risk trend (avg_risk over the
 * risk_history window). Hand-rolled SVG (no chart lib, matching the app's
 * PostureTrendChart), with a dimension selector and a 30/60/90-day range toggle.
 * Drill-down: picking a dimension re-scopes the line and the summary deltas.
 */

import { useMemo, useState } from "react";
import {
  seriesToPoints,
  dimensionLabel,
  riskBandMeta,
  round1,
  type DimensionTrend,
} from "@/lib/executiveRisk";

const TEAL = "#00c4b4";
const LINE = "#1e293b";
const MUTED = "#64748b";
const W = 620;
const H = 160;
const PAD_X = 20;
const PAD_Y = 22;

function formatLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function RiskTrendChart({ trends }: { trends: DimensionTrend[] }) {
  const withHistory = useMemo(() => trends.filter((t) => t.points.length > 0), [trends]);
  const [dimension, setDimension] = useState<string>(withHistory[0]?.dimension ?? "");
  const [days, setDays] = useState<30 | 60 | 90>(90);

  const selected = withHistory.find((t) => t.dimension === dimension) ?? withHistory[0];

  const filtered = useMemo(() => {
    if (!selected) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return selected.points
      .filter((p) => new Date(p.snapshot_date) >= cutoff)
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  }, [selected, days]);

  if (!selected) {
    return (
      <div className="rounded-lg border border-dashed border-brand-line px-4 py-8 text-center">
        <p className="text-xs" style={{ color: MUTED }}>
          No history yet. Trends populate after the daily risk snapshot runs.
        </p>
      </div>
    );
  }

  const pts = seriesToPoints(filtered.map((p) => p.avg_risk), { width: W, height: H, padX: PAD_X, padY: PAD_Y });
  const current = filtered[filtered.length - 1];

  return (
    <div>
      {/* Dimension selector */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {withHistory.map((t) => {
          const active = t.dimension === selected.dimension;
          return (
            <button
              key={t.dimension}
              onClick={() => setDimension(t.dimension)}
              className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                background: active ? "rgba(0,196,180,0.15)" : "transparent",
                color: active ? "#5eead4" : MUTED,
                border: `1px solid ${active ? "rgba(0,196,180,0.4)" : LINE}`,
              }}
            >
              {dimensionLabel(t.dimension)}
            </button>
          );
        })}
      </div>

      {/* Header: current value + range toggle */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            {current ? round1(current.avg_risk) : "—"}
          </span>
          <span className="text-xs" style={{ color: MUTED }}>
            avg risk · {filtered.length} {filtered.length === 1 ? "snapshot" : "snapshots"}
          </span>
        </div>
        <div className="flex gap-1">
          {([30, 60, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors"
              style={{
                background: days === d ? TEAL : "transparent",
                color: days === d ? "#0a0f1a" : MUTED,
                border: `1px solid ${days === d ? TEAL : LINE}`,
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-brand-line px-4 py-8 text-center">
          <p className="text-xs" style={{ color: MUTED }}>No snapshots in this window.</p>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} aria-label={`${dimensionLabel(selected.dimension)} average risk over time`}>
          {/* risk band guides at 30/60/80 */}
          {[30, 60, 80].map((level) => {
            const y = PAD_Y + (H - PAD_Y * 2) - (level / 100) * (H - PAD_Y * 2);
            return <line key={level} x1={PAD_X} y1={y} x2={W - PAD_X} y2={y} stroke={LINE} strokeWidth="1" strokeDasharray="3 5" />;
          })}
          {filtered.length >= 2 && (
            <>
              <polygon
                points={[...pts.map((p) => `${p.x},${p.y}`), `${pts[pts.length - 1]!.x},${H - PAD_Y}`, `${pts[0]!.x},${H - PAD_Y}`].join(" ")}
                fill={TEAL}
                fillOpacity="0.10"
              />
              <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={TEAL} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          {filtered.map((p, i) => {
            const pt = pts[i]!;
            const meta = riskBandMeta(p.avg_risk);
            return (
              <g key={p.snapshot_date}>
                <circle cx={pt.x} cy={pt.y} r={filtered.length === 1 ? 5 : 3} fill={meta.color}>
                  <title>{formatLabel(p.snapshot_date)}: avg {round1(p.avg_risk)}, {p.at_risk_count} at risk</title>
                </circle>
                {(i === 0 || i === filtered.length - 1) && (
                  <text x={pt.x} y={H - PAD_Y + 14} textAnchor="middle" fontSize="10" fill={MUTED}>
                    {formatLabel(p.snapshot_date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
