/**
 * executive/page.tsx — the ERIP Executive Risk dashboard. A server component
 * that gates on platform entitlement, fetches every executive surface in
 * parallel (each dark behind its own engine feature flag), and composes the
 * KPI scorecard, interactive trend chart, dimensional heatmap, predictive
 * insights, and connector-fleet health. Each panel degrades independently: a
 * disabled feature shows an informational notice, a real error shows an error
 * panel, and the page never fails as a whole.
 *
 * Nav entry is dark behind SECURELOGIC_RISK_INTELLIGENCE_ENABLED (navigation.ts
 * + layout.tsx); the engine 404s each route independently (two-switch model).
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getRiskKpis,
  getRiskTrends,
  getPredictiveInsights,
  getPostureForecast,
  getConnectorHealth,
} from "@/lib/api";
import { countRising, dimensionLabel } from "@/lib/executiveRisk";
import { ExecutiveKpiCards } from "./ExecutiveKpiCards";
import { RiskTrendChart } from "./RiskTrendChart";
import { RiskHeatmap } from "./RiskHeatmap";
import { PredictiveInsightsPanel } from "./PredictiveInsightsPanel";
import { ConnectorHealthPanel } from "./ConnectorHealthPanel";
import { Panel, DisabledNotice, PanelError, EmptyNotice } from "./shared";

export const dynamic = "force-dynamic";

export default async function ExecutivePage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [kpis, trends, insights, forecast, health] = await Promise.all([
    getRiskKpis(token, 90),
    getRiskTrends(token, 90),
    getPredictiveInsights(token),
    getPostureForecast(token, 30),
    getConnectorHealth(token),
  ]);

  const rising = trends.ok ? countRising(trends.trends) : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>Executive Risk</h1>
          <p className="mt-1 text-sm" style={{ color: "#94a3b8" }}>
            Enterprise risk posture, trends, forecast, and connector health — one leadership view.
          </p>
        </div>
        {kpis.ok && (
          <a
            href="/api/export/risk-trends"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{ borderColor: "#1e293b", color: "#94a3b8" }}
          >
            ↓ Export CSV
          </a>
        )}
      </div>

      {/* KPI scorecard */}
      {kpis.ok ? (
        <ExecutiveKpiCards kpis={kpis.kpis} windowDays={kpis.window_days} />
      ) : (
        <Panel title="Risk KPIs">
          {kpis.disabled ? <DisabledNotice feature="Risk intelligence" /> : <PanelError error={kpis.error} />}
        </Panel>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Trends */}
        <Panel
          title="Risk trends"
          subtitle={trends.ok ? `${rising} dimension${rising === 1 ? "" : "s"} rising` : undefined}
        >
          {trends.ok ? (
            trends.trends.length === 0 ? (
              <EmptyNotice message="No history yet. Trends populate after the daily risk snapshot runs." />
            ) : (
              <RiskTrendChart trends={trends.trends} />
            )
          ) : trends.disabled ? (
            <DisabledNotice feature="Risk intelligence" />
          ) : (
            <PanelError error={trends.error} />
          )}
        </Panel>

        {/* Predictive */}
        <Panel title="Predictive intelligence">
          {insights.ok ? (
            <PredictiveInsightsPanel
              insights={insights.insights}
              horizonDays={insights.horizon_days}
              forecast={forecast.ok ? forecast : null}
            />
          ) : insights.disabled ? (
            <DisabledNotice feature="Predictive intelligence" />
          ) : (
            <PanelError error={insights.error} />
          )}
        </Panel>
      </div>

      {/* Heatmap */}
      <div className="mt-6">
        <Panel title="Risk by dimension" subtitle="Current avg / peak risk, at-risk counts, and trend">
          {trends.ok ? (
            <RiskHeatmap trends={trends.trends} />
          ) : trends.disabled ? (
            <DisabledNotice feature="Risk intelligence" />
          ) : (
            <PanelError error={trends.error} />
          )}
        </Panel>
      </div>

      {/* Connector health */}
      <div className="mt-6">
        <Panel title="Connector health" subtitle="Discovery + writeback fleet status">
          {health.ok ? (
            <ConnectorHealthPanel health={health} />
          ) : health.disabled ? (
            <DisabledNotice feature="Enterprise connectors" />
          ) : (
            <PanelError error={health.error} />
          )}
        </Panel>
      </div>

      {trends.ok && trends.trends.length > 0 && (
        <p className="mt-6 text-center text-xs" style={{ color: "#475569" }}>
          Enterprise dimension leads; other rows are {trends.trends.slice(1).map((t) => dimensionLabel(t.dimension)).join(", ") || "asset types"}.
        </p>
      )}
    </div>
  );
}
