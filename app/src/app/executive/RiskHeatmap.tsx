/**
 * RiskHeatmap.tsx — dimension × risk heatmap. One row per risk dimension
 * (enterprise + each asset type), cells colored by the current avg/peak risk
 * band, with at-risk counts and trend direction. Server-renderable.
 */

import {
  dimensionLabel,
  riskBandMeta,
  round1,
  type DimensionTrend,
} from "@/lib/executiveRisk";

const MUTED = "#64748b";

function Cell({ score }: { score: number }) {
  const meta = riskBandMeta(score);
  return (
    <td className="px-2 py-2 text-center">
      <span
        className="inline-flex min-w-[3rem] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold"
        style={{ background: `${meta.color}26`, color: meta.text, border: `1px solid ${meta.color}55` }}
        title={`${meta.label} (${round1(score)})`}
      >
        {round1(score)}
      </span>
    </td>
  );
}

function DirectionCell({ direction }: { direction: DimensionTrend["direction"] }) {
  const map = { up: { s: "▲", c: "#fca5a5" }, down: { s: "▼", c: "#86efac" }, flat: { s: "—", c: MUTED } };
  const m = map[direction];
  return (
    <td className="px-2 py-2 text-center text-sm font-semibold" style={{ color: m.c }}>
      {m.s}
    </td>
  );
}

export function RiskHeatmap({
  trends,
  onSelect,
  selected,
}: {
  trends: DimensionTrend[];
  onSelect?: (dimension: string) => void;
  selected?: string;
}) {
  const rows = trends.filter((t) => t.current !== null);
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-brand-line px-4 py-6 text-center">
        <p className="text-xs" style={{ color: MUTED }}>No dimensional risk data yet.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ color: MUTED }} className="text-xs uppercase tracking-wide">
            <th className="px-2 py-2 text-left font-medium">Dimension</th>
            <th className="px-2 py-2 text-center font-medium">Avg risk</th>
            <th className="px-2 py-2 text-center font-medium">Peak risk</th>
            <th className="px-2 py-2 text-center font-medium">At risk</th>
            <th className="px-2 py-2 text-center font-medium">Assets</th>
            <th className="px-2 py-2 text-center font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const c = t.current!;
            const isEnterprise = t.dimension === "enterprise";
            const isSelected = selected === t.dimension;
            return (
              <tr
                key={t.dimension}
                onClick={onSelect ? () => onSelect(t.dimension) : undefined}
                className="border-t border-brand-line"
                style={{
                  cursor: onSelect ? "pointer" : "default",
                  background: isSelected ? "rgba(0,196,180,0.08)" : undefined,
                }}
              >
                <td className="px-2 py-2 text-left font-medium" style={{ color: isEnterprise ? "#f1f5f9" : "#cbd5e1" }}>
                  {isSelected && <span style={{ color: "#00c4b4" }}>› </span>}
                  {dimensionLabel(t.dimension)}
                </td>
                <Cell score={c.avg_risk} />
                <Cell score={c.max_risk} />
                <td className="px-2 py-2 text-center" style={{ color: "#cbd5e1" }}>{c.at_risk_count}</td>
                <td className="px-2 py-2 text-center" style={{ color: MUTED }}>{c.asset_count}</td>
                <DirectionCell direction={t.direction} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
