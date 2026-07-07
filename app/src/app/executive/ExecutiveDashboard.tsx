"use client";

/**
 * ExecutiveDashboard.tsx — the interactive multi-view executive surface. A view
 * selector spans every risk dimension the platform tracks (enterprise + each
 * asset type: cloud, AI, application, endpoint, API, identity, vendor, …), and
 * the KPI scorecard, trend chart, and period comparison all re-scope to the
 * selected view from the SHARED risk_history series. The heatmap doubles as a
 * drill-down: clicking a dimension row selects that view. The two global panels
 * (predictive, connector health) are rendered by the server page and slotted in.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  dimensionKpis,
  dimensionComparison,
  dimensionLabel,
  countRising,
  type DimensionTrend,
} from "@/lib/executiveRisk";
import { ExecutiveKpiCards } from "./ExecutiveKpiCards";
import { RiskTrendChart } from "./RiskTrendChart";
import { RiskHeatmap } from "./RiskHeatmap";
import { ComparisonPanel } from "./ComparisonPanel";
import { Panel, EmptyNotice } from "./shared";

export function ExecutiveDashboard({
  trends,
  windowDays,
  predictivePanel,
  healthPanel,
}: {
  trends: DimensionTrend[];
  windowDays: number;
  predictivePanel: ReactNode;
  healthPanel: ReactNode;
}) {
  // Views in a stable order: enterprise first, then by current peak risk (the
  // server already sorts trends this way).
  const views = useMemo(() => trends.filter((t) => t.points.length > 0 || t.current !== null), [trends]);
  const [selected, setSelected] = useState<string>(views[0]?.dimension ?? "enterprise");

  const current = views.find((t) => t.dimension === selected) ?? views[0];
  const rising = countRising(trends);

  if (!current) {
    return (
      <Panel title="Executive views">
        <EmptyNotice message="No risk history yet. Executive views populate after the daily risk snapshot runs." />
      </Panel>
    );
  }

  const kpis = dimensionKpis(current);
  const comparison = dimensionComparison(current);

  return (
    <div className="space-y-6">
      {/* View selector — every domain / dimension the platform tracks. */}
      <div className="flex flex-wrap gap-1.5">
        {views.map((t) => {
          const active = t.dimension === selected;
          return (
            <button
              key={t.dimension}
              onClick={() => setSelected(t.dimension)}
              className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: active ? "rgba(0,196,180,0.15)" : "transparent",
                color: active ? "#5eead4" : "#94a3b8",
                border: `1px solid ${active ? "rgba(0,196,180,0.4)" : "#1e293b"}`,
              }}
            >
              {dimensionLabel(t.dimension)}
            </button>
          );
        })}
      </div>

      {/* Scoped KPI scorecard for the selected view. */}
      <ExecutiveKpiCards kpis={kpis} windowDays={windowDays} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title={`${dimensionLabel(current.dimension)} trend`} subtitle={`${rising} dimension${rising === 1 ? "" : "s"} rising overall`}>
          <RiskTrendChart trend={current} />
        </Panel>
        <Panel title={`${dimensionLabel(current.dimension)} comparison`} subtitle="Window start vs now">
          <ComparisonPanel comparison={comparison} windowDays={windowDays} />
        </Panel>
      </div>

      {/* Predictive (global). */}
      <Panel title="Predictive intelligence">{predictivePanel}</Panel>

      {/* Heatmap — all dimensions, click a row to drill into that view. */}
      <Panel title="Risk by dimension" subtitle="Click a row to scope the views above · current avg / peak risk, at-risk, trend">
        <RiskHeatmap trends={trends} onSelect={setSelected} selected={selected} />
      </Panel>

      {/* Connector health (global). */}
      <Panel title="Connector health" subtitle="Discovery + writeback fleet status">{healthPanel}</Panel>
    </div>
  );
}
