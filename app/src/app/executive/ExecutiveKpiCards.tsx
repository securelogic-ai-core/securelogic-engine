/**
 * ExecutiveKpiCards.tsx — the KPI scorecard row. Server-renderable; consumes
 * GET /api/risk/kpis. Risk metrics color an increase RED (worse); asset growth
 * is neutral.
 */

import { formatDelta, round1, type KpiCard } from "@/lib/executiveRisk";

const TONE_COLOR: Record<string, string> = { good: "#86efac", bad: "#fca5a5", neutral: "#94a3b8" };

export function ExecutiveKpiCards({ kpis, windowDays }: { kpis: KpiCard[]; windowDays: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.map((k) => {
        const d = formatDelta(k.key, k.change);
        return (
          <div key={k.key} className="rounded-xl border border-brand-line bg-brand-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#64748b" }}>
              {k.label}
            </p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "#f1f5f9" }}>
              {round1(k.value)}
            </p>
            <p className="mt-1 text-xs font-medium" style={{ color: TONE_COLOR[d.tone] }}>
              {d.arrow} {d.text}
              <span style={{ color: "#475569" }}> · {windowDays}d</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}
