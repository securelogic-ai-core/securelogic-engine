/**
 * executive/page.tsx — the ERIP Executive Risk dashboard. A server component
 * that gates on platform entitlement, fetches every executive surface in
 * parallel (each dark behind its own engine feature flag), and hands the risk
 * trends to the interactive ExecutiveDashboard (multi-view: enterprise + every
 * asset-type / domain dimension, with per-view KPIs, trend, comparison, heatmap
 * drill-down). The two global panels (predictive, connector health) are
 * pre-rendered here with their disabled/error gating and slotted into the
 * client dashboard.
 *
 * Each surface degrades independently: a disabled feature shows an
 * informational notice, a real error shows an error panel, and the page never
 * fails as a whole. Nav entry is dark behind SECURELOGIC_RISK_INTELLIGENCE_ENABLED.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getRiskTrends,
  getPredictiveInsights,
  getPostureForecast,
  getConnectorHealth,
} from "@/lib/api";
import { ExecutiveDashboard } from "./ExecutiveDashboard";
import { PredictiveInsightsPanel } from "./PredictiveInsightsPanel";
import { ConnectorHealthPanel } from "./ConnectorHealthPanel";
import { Panel, DisabledNotice, PanelError, EmptyNotice } from "./shared";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;

export default async function ExecutivePage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [trends, insights, forecast, health] = await Promise.all([
    getRiskTrends(token, WINDOW_DAYS),
    getPredictiveInsights(token),
    getPostureForecast(token, 30),
    getConnectorHealth(token),
  ]);

  const predictivePanel = insights.ok ? (
    <PredictiveInsightsPanel
      insights={insights.insights}
      horizonDays={insights.horizon_days}
      forecast={forecast.ok ? forecast : null}
    />
  ) : insights.disabled ? (
    <DisabledNotice feature="Predictive intelligence" />
  ) : (
    <PanelError error={insights.error} />
  );

  const healthPanel = health.ok ? (
    <ConnectorHealthPanel health={health} />
  ) : health.disabled ? (
    <DisabledNotice feature="Enterprise connectors" />
  ) : (
    <PanelError error={health.error} />
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>Executive Risk</h1>
          <p className="mt-1 text-sm" style={{ color: "#94a3b8" }}>
            Enterprise risk posture across every domain — trends, KPIs, forecast, and connector health in one leadership view.
          </p>
        </div>
        {trends.ok && (
          <a
            href="/api/export/risk-trends"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{ borderColor: "#1e293b", color: "#94a3b8" }}
          >
            ↓ Export CSV
          </a>
        )}
      </div>

      {trends.ok ? (
        trends.trends.length === 0 ? (
          <>
            <Panel title="Executive views">
              <EmptyNotice message="No risk history yet. Executive views populate after the daily risk snapshot runs." />
            </Panel>
            <div className="mt-6 space-y-6">
              <Panel title="Predictive intelligence">{predictivePanel}</Panel>
              <Panel title="Connector health">{healthPanel}</Panel>
            </div>
          </>
        ) : (
          <ExecutiveDashboard
            trends={trends.trends}
            windowDays={trends.window_days}
            predictivePanel={predictivePanel}
            healthPanel={healthPanel}
          />
        )
      ) : (
        <>
          <Panel title="Executive views">
            {trends.disabled ? <DisabledNotice feature="Risk intelligence" /> : <PanelError error={trends.error} />}
          </Panel>
          <div className="mt-6 space-y-6">
            <Panel title="Predictive intelligence">{predictivePanel}</Panel>
            <Panel title="Connector health">{healthPanel}</Panel>
          </div>
        </>
      )}
    </div>
  );
}
