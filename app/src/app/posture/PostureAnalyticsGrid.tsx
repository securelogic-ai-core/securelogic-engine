import type { DashboardSummary, Framework, FrameworkReadiness, PostureSnapshot } from "@/lib/api";
import {
  RisksBreakdown,
  RiskHeatmap,
  ActionsRing,
  OpenItemsAging,
  VendorRiskCard,
  FrameworkGaps,
  ComplianceCoverage,
  InventoryGrid,
} from "@/app/dashboard/DashboardCharts";
import { PostureTrendChart } from "@/app/dashboard/PostureTrendChart";

type FrameworkPair = { framework: Framework; readiness: FrameworkReadiness | null };

/**
 * PostureAnalyticsGrid — the canonical org-performance analytics composition
 * (read-surface architecture D1). /posture is the Dashboards surface: shared
 * organizational truth in a FIXED order — deliberately no per-user customize
 * (personalization is a Briefing property, not a Dashboard property).
 *
 * Single implementation rule: every tile below reuses the one existing chart
 * component. The legacy flag-off /dashboard (`PostureDashboard`) renders the
 * same components until it retires with the Briefing prod flip — two render
 * sites, one implementation each.
 *
 * Three legacy tiles are intentionally NOT repeated here because /posture
 * already reproduces them natively at equal-or-richer depth:
 *   posture_score  → the Overall Posture Score header card
 *   findings_donut → the Active Findings by Severity card grid
 *   domain_posture → the Domain Breakdown table
 */
export function PostureAnalyticsGrid({
  summary,
  frameworkPairs,
  postureSnapshots,
}: {
  summary: DashboardSummary;
  frameworkPairs: FrameworkPair[];
  postureSnapshots: PostureSnapshot[];
}) {
  const { findings, actions, controls_cadence, inventory, vendor_risk, risks_summary } = summary;

  return (
    <div className="mt-10" data-posture-analytics>
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: "#64748b" }}>
        Analytics
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4 2xl:gap-6">
        <div className="h-full"><RisksBreakdown risks_summary={risks_summary} /></div>
        <div className="h-full"><RiskHeatmap risks_summary={risks_summary} /></div>
        <div className="h-full"><ActionsRing actions={actions} /></div>
        <div className="sm:col-span-2 lg:col-span-3 h-full">
          <PostureTrendChart snapshots={postureSnapshots} />
        </div>
        <div className="h-full"><VendorRiskCard vendor_risk={vendor_risk} /></div>
        <div className="h-full"><FrameworkGaps pairs={frameworkPairs} /></div>
        <div className="h-full"><ComplianceCoverage frameworkPairs={frameworkPairs} /></div>
        <div className="sm:col-span-2 lg:col-span-3 h-full">
          <OpenItemsAging findings={findings} actions={actions} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3 h-full">
          <InventoryGrid inventory={inventory} controls_cadence={controls_cadence} />
        </div>
      </div>
    </div>
  );
}
