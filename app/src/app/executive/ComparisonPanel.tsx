/**
 * ComparisonPanel.tsx — period-over-period comparison for a dimension (window
 * start vs current). Risk-metric increases render red (worse); asset growth
 * neutral. Consumes PeriodComparison[] (dimensionComparison).
 */

import {
  comparisonMetricLabel,
  round1,
  type PeriodComparison,
} from "@/lib/executiveRisk";

const MUTED = "#64748b";

function deltaTone(metric: string, delta: number): { color: string; arrow: string } {
  if (delta === 0) return { color: MUTED, arrow: "—" };
  const isRisk = metric !== "asset_count";
  const bad = isRisk ? delta > 0 : false;
  return { color: bad ? "#fca5a5" : delta > 0 ? "#86efac" : "#86efac", arrow: delta > 0 ? "▲" : "▼" };
}

export function ComparisonPanel({ comparison, windowDays }: { comparison: PeriodComparison[]; windowDays: number }) {
  if (comparison.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-brand-line px-4 py-4 text-center">
        <p className="text-xs" style={{ color: MUTED }}>Not enough history to compare yet.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ color: MUTED }} className="text-xs uppercase tracking-wide">
            <th className="px-2 py-1.5 text-left font-medium">Metric</th>
            <th className="px-2 py-1.5 text-right font-medium">{windowDays}d ago</th>
            <th className="px-2 py-1.5 text-right font-medium">Now</th>
            <th className="px-2 py-1.5 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {comparison.map((row) => {
            const t = deltaTone(row.metric, row.delta);
            return (
              <tr key={row.metric} className="border-t border-brand-line">
                <td className="px-2 py-1.5 text-left" style={{ color: "#cbd5e1" }}>{comparisonMetricLabel(row.metric)}</td>
                <td className="px-2 py-1.5 text-right" style={{ color: MUTED }}>{round1(row.b)}</td>
                <td className="px-2 py-1.5 text-right font-medium" style={{ color: "#e2e8f0" }}>{round1(row.a)}</td>
                <td className="px-2 py-1.5 text-right font-medium" style={{ color: t.color }}>
                  {t.arrow} {row.delta === 0 ? "0" : `${row.delta > 0 ? "+" : ""}${round1(row.delta)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
