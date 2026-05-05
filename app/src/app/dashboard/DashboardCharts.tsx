import Link from "next/link";
import type { DashboardSummary, DomainScore, Framework, FrameworkReadiness } from "@/lib/api";

const CRIT_COLORS: Record<string, { bar: string; badge: string; text: string }> = {
  critical:      { bar: "#ef4444", badge: "rgba(239,68,68,0.15)",   text: "#fca5a5" },
  high:          { bar: "#f97316", badge: "rgba(249,115,22,0.15)",  text: "#fdba74" },
  medium:        { bar: "#f59e0b", badge: "rgba(245,158,11,0.15)",  text: "#fcd34d" },
  low:           { bar: "#22c55e", badge: "rgba(34,197,94,0.15)",   text: "#86efac" },
  uncategorized: { bar: "#334155", badge: "rgba(100,116,139,0.1)",  text: "#64748b" },
};

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  High:     "#f97316",
  Moderate: "#f59e0b",
  Low:      "#22c55e",
};
const TEAL       = "#00c4b4";
const AMBER      = "#f59e0b";
const SLATE_LINE = "#1e293b";
const TEXT_MUTED = "#64748b";
const SURFACE    = "var(--color-brand-surface, #111827)";

// Shared donut geometry used by FindingsDonut, ActionsRing, and
// VendorRiskCard so the three donuts on the dashboard render at the
// same physical size. Pre-normalization, FindingsDonut was 100px /
// effective-15px stroke, ActionsRing was 80px / 12px, VendorRiskCard
// was 80px / 12px. Single source of truth here; downstream cx/cy/r
// are derived.
const DONUT_SIZE   = 144;                // diameter in CSS pixels
const DONUT_STROKE = 16;                 // ring thickness
const DONUT_C      = DONUT_SIZE / 2;     // center cx and cy
const DONUT_R      = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRC   = 2 * Math.PI * DONUT_R;

/**
 * scoreColor — colorizer for POSTURE-style metrics (higher = better).
 *
 * Use for: framework readiness % (satisfied / total_requirements),
 * compliance coverage %, control implementation %.
 *
 * High score → green; low score → red.
 *
 * DO NOT use for the posture engine's domain risk scores — those are
 * RISK-style (higher = worse). Use riskColor for those.
 */
function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

/**
 * riskColor — colorizer for RISK-style metrics (higher = worse).
 *
 * Use for: posture engine's domain risk scores
 * (DomainRiskAggregationEngineV2 output, materialized as
 * domain_scores.score). The engine's bands are Critical ≥85,
 * High ≥65, Moderate ≥40, else Low — see
 * src/engine/policy/defaultScoringPolicy.ts and
 * src/engine/scoring/v2/DomainRiskAggregationEngineV2.ts:49-54.
 *
 * High score → red; low score → green. The bar color matches the
 * severity badge already shown alongside the score.
 *
 * DO NOT use for posture-style metrics — use scoreColor instead.
 */
function riskColor(score: number): string {
  if (score >= 85) return "#ef4444"; // Critical
  if (score >= 65) return "#f97316"; // High
  if (score >= 40) return "#f59e0b"; // Moderate
  return "#22c55e";                   // Low
}

/**
 * CompactEmptyState — shared empty-state body used inside cards whose
 * primary content has no data yet. Renders at roughly 60% the height
 * of a populated card by virtue of dropping the chart/list/grid that
 * would otherwise fill the card body.
 *
 * The wrapping <div className="rounded-xl border ..."> stays on each
 * card; this component is rendered INSIDE that wrapper, replacing the
 * card body. The card retains its title and any header CTA.
 *
 * Used by (in this file):
 *   - ComplianceCoverage  (no frameworks assessed)
 *   - FrameworkGaps       (no frameworks activated)
 *   - DomainPostureBars   (no domain data — single-populated renders
 *                          the actual bar, not a stub)
 *   - RiskHeatmap         (no risk data)
 *
 * Exported and reused in:
 *   - PostureTrendChart.tsx (insufficient snapshots)
 *   - dashboard/page.tsx → FrameworkReadinessWidget (none activated)
 */
export function CompactEmptyState({
  message,
  ctaLabel,
  ctaHref,
}: {
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-6 gap-2"
      style={{ minHeight: "104px" }}
    >
      <p className="text-xs" style={{ color: TEXT_MUTED }}>
        {message}
      </p>
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="text-xs font-medium hover:opacity-80 transition-opacity"
          style={{ color: TEAL }}
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}

function TrendArrow({ direction }: { direction?: string | null }) {
  if (!direction || direction === "unknown") return null;
  if (direction === "improving") return <span style={{ color: "#22c55e", fontSize: "10px", fontWeight: 700 }}>↑</span>;
  if (direction === "worsening") return <span style={{ color: "#ef4444", fontSize: "10px", fontWeight: 700 }}>↓</span>;
  return <span style={{ color: "#64748b", fontSize: "10px" }}>→</span>;
}

// ── FindingsDonut ──────────────────────────────────────────────

export function FindingsDonut({
  findings,
}: {
  findings: DashboardSummary["findings"];
}) {
  const total = findings.open;

  const segments = (["Critical", "High", "Moderate", "Low"] as const).map((sev) => ({
    sev,
    count: findings.by_severity[sev] ?? 0,
    color: SEVERITY_COLORS[sev]!,
  }));

  let accumulated = 0;

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: TEXT_MUTED }}>
        Open Findings
      </p>
      <div className="flex items-center gap-5">
        <div className="flex-shrink-0">
          <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} width={DONUT_SIZE} height={DONUT_SIZE}>
            <circle cx={DONUT_C} cy={DONUT_C} r={DONUT_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={DONUT_STROKE} />
            {total > 0 ? (
              segments.filter((s) => s.count > 0).map(({ sev, count, color }) => {
                const arc = (count / total) * DONUT_CIRC;
                const offset = -accumulated;
                accumulated += arc;
                return (
                  <circle
                    key={sev}
                    cx={DONUT_C} cy={DONUT_C} r={DONUT_R}
                    fill="none" stroke={color} strokeWidth={DONUT_STROKE}
                    strokeDasharray={`${arc} ${DONUT_CIRC - arc}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${DONUT_C} ${DONUT_C})`}
                    strokeLinecap="butt"
                  />
                );
              })
            ) : (
              <circle
                cx={DONUT_C} cy={DONUT_C} r={DONUT_R}
                fill="none" stroke="#22c55e" strokeWidth={DONUT_STROKE}
                strokeDasharray={`${DONUT_CIRC} 0`}
                transform={`rotate(-90 ${DONUT_C} ${DONUT_C})`}
              />
            )}
            <text x={DONUT_C} y={DONUT_C - 6} textAnchor="middle" fill="#f1f5f9" fontSize="28" fontWeight="700">
              {total}
            </text>
            <text x={DONUT_C} y={DONUT_C + 16} textAnchor="middle" fill={TEXT_MUTED} fontSize="11">
              findings
            </text>
          </svg>
        </div>
        <div className="flex-1 space-y-2">
          {(["Critical", "High", "Moderate", "Low"] as const).map((sev) => {
            const count = findings.by_severity[sev] ?? 0;
            return (
              <Link
                key={sev}
                href={`/findings?severity=${sev}&status=open`}
                className="flex items-center gap-2 text-xs hover:opacity-80 transition-opacity"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SEVERITY_COLORS[sev] }} />
                <span style={{ color: "#94a3b8" }}>{sev}</span>
                <span className="ml-auto font-bold tabular-nums" style={{ color: count > 0 ? "#f1f5f9" : TEXT_MUTED }}>
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      <Link href="/findings?status=open" className="block mt-4 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
        View all open findings →
      </Link>
    </div>
  );
}

// ── DomainPostureBars ──────────────────────────────────────────

export function DomainPostureBars({ domains }: { domains: DomainScore[] }) {
  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Domain Scores
        </p>
        <Link href="/posture" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          Full breakdown →
        </Link>
      </div>
      {domains.length === 0 ? (
        <CompactEmptyState
          message="No domain data yet."
          ctaLabel="View posture →"
          ctaHref="/posture"
        />
      ) : (
        <div className="space-y-3">
          {domains.slice(0, 6).map((d) => {
            const score = d.score ?? 0;
            // riskColor (not scoreColor): the engine produces a risk
            // score where higher = more risk. Pre-fix the bar
            // colorizer was inverted, rendering Critical-risk
            // domains green.
            const color = riskColor(score);
            return (
              <Link
                key={d.domain}
                href={`/findings?domain=${encodeURIComponent(d.domain)}&status=open`}
                className="block hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs truncate max-w-[120px]" style={{ color: "#cbd5e1" }}>{d.domain}</span>
                  <span className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <TrendArrow direction={d.trend_direction} />
                    <span className="text-xs font-bold tabular-nums" style={{ color }}>{score}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${Math.min(score, 100)}%`, background: color }} />
                </div>
              </Link>
            );
          })}
          {domains.length > 6 && (
            <p className="text-xs" style={{ color: TEXT_MUTED }}>+{domains.length - 6} more domains</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── ActionsRing ────────────────────────────────────────────────

export function ActionsRing({ actions }: { actions: DashboardSummary["actions"] }) {
  const openCount       = actions.open        ?? 0;
  const inProgressCount = actions.in_progress ?? 0;
  const overdueCount    = actions.overdue      ?? 0;
  const total = openCount + inProgressCount;
  const openArc        = total > 0 ? (openCount        / total) * DONUT_CIRC : 0;
  const inProgressArc  = total > 0 ? (inProgressCount  / total) * DONUT_CIRC : 0;

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: TEXT_MUTED }}>
        Actions
      </p>
      <div className="flex items-center gap-5">
        <div className="flex-shrink-0">
          <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} width={DONUT_SIZE} height={DONUT_SIZE}>
            <circle cx={DONUT_C} cy={DONUT_C} r={DONUT_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={DONUT_STROKE} />
            {total > 0 ? (
              <>
                {openCount > 0 && (
                  <circle
                    cx={DONUT_C} cy={DONUT_C} r={DONUT_R}
                    fill="none" stroke={TEAL} strokeWidth={DONUT_STROKE}
                    strokeDasharray={`${openArc} ${DONUT_CIRC - openArc}`}
                    strokeDashoffset={0}
                    transform={`rotate(-90 ${DONUT_C} ${DONUT_C})`}
                    strokeLinecap="butt"
                  />
                )}
                {inProgressCount > 0 && (
                  <circle
                    cx={DONUT_C} cy={DONUT_C} r={DONUT_R}
                    fill="none" stroke={AMBER} strokeWidth={DONUT_STROKE}
                    strokeDasharray={`${inProgressArc} ${DONUT_CIRC - inProgressArc}`}
                    strokeDashoffset={-openArc}
                    transform={`rotate(-90 ${DONUT_C} ${DONUT_C})`}
                    strokeLinecap="butt"
                  />
                )}
              </>
            ) : (
              <circle
                cx={DONUT_C} cy={DONUT_C} r={DONUT_R}
                fill="none" stroke="#22c55e" strokeWidth={DONUT_STROKE}
                strokeDasharray={`${DONUT_CIRC} 0`}
                transform={`rotate(-90 ${DONUT_C} ${DONUT_C})`}
              />
            )}
            <text x={DONUT_C} y={DONUT_C - 4} textAnchor="middle" fill="#f1f5f9" fontSize="24" fontWeight="700">
              {total}
            </text>
            <text x={DONUT_C} y={DONUT_C + 16} textAnchor="middle" fill={TEXT_MUTED} fontSize="11">
              active
            </text>
          </svg>
        </div>
        <div className="flex-1 space-y-2">
          <Link href="/actions?status=open" className="flex items-center gap-2 text-xs hover:opacity-80 transition-opacity">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: TEAL }} />
            <span style={{ color: "#94a3b8" }}>Open</span>
            <span className="ml-auto font-bold tabular-nums" style={{ color: "#f1f5f9" }}>{openCount}</span>
          </Link>
          <Link href="/actions?status=in_progress" className="flex items-center gap-2 text-xs hover:opacity-80 transition-opacity">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: AMBER }} />
            <span style={{ color: "#94a3b8" }}>In Progress</span>
            <span className="ml-auto font-bold tabular-nums" style={{ color: "#f1f5f9" }}>{inProgressCount}</span>
          </Link>
          {overdueCount > 0 && (
            <Link href="/actions?overdue=true" className="flex items-center gap-2 text-xs hover:opacity-80 transition-opacity">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-red-500" />
              <span style={{ color: "#fca5a5" }}>Overdue</span>
              <span className="ml-auto font-bold tabular-nums" style={{ color: "#fca5a5" }}>{overdueCount}</span>
            </Link>
          )}
        </div>
      </div>
      <Link href="/actions" className="block mt-4 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
        View all actions →
      </Link>
    </div>
  );
}

// ── OpenItemsAging ─────────────────────────────────────────────

function AgingSection({
  label,
  href,
  open,
  avgAge,
  maxAge,
  olderThan30,
  olderThan7,
}: {
  label:       string;
  href:        string;
  open:        number;
  avgAge:      number | null | undefined;
  maxAge:      number | null | undefined;
  olderThan30: number;
  olderThan7:  number;
}) {
  const lessThan7 = Math.max(0, open - olderThan30 - olderThan7);

  const buckets = [
    { label: ">30 days", count: olderThan30, color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
    { label: "7–30 days", count: olderThan7,  color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
    { label: "<7 days",  count: lessThan7,   color: "#00c4b4", bg: "rgba(0,196,180,0.12)" },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: TEXT_MUTED }}>
        {label}
      </p>

      {/* Avg age */}
      <p className="font-bold leading-none mb-0.5" style={{ fontSize: "26px", color: open > 0 ? "#f1f5f9" : TEXT_MUTED }}>
        {avgAge != null && avgAge > 0 ? Math.round(avgAge) : "—"}
      </p>
      <p className="text-xs mb-3" style={{ color: TEXT_MUTED }}>avg days open</p>

      {/* Buckets */}
      <div className="space-y-1.5">
        {buckets.map(({ label: bl, count, color, bg }) => (
          <div key={bl} className="flex items-center justify-between gap-2">
            <span className="text-xs" style={{ color: TEXT_MUTED }}>{bl}</span>
            <span
              style={{
                background:   count > 0 ? bg    : "rgba(100,116,139,0.08)",
                color:        count > 0 ? color : "#475569",
                fontSize:     "10px",
                fontWeight:   600,
                padding:      "1px 7px",
                borderRadius: "20px",
                minWidth:     "24px",
                textAlign:    "center",
              }}
            >
              {count}
            </span>
          </div>
        ))}
      </div>

      {/* Oldest */}
      {maxAge != null && maxAge > 0 && (
        <p className="mt-2 text-xs" style={{ color: TEXT_MUTED }}>
          Oldest: {maxAge}d
        </p>
      )}

      <Link href={href} className="block mt-3 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
        View {label.toLowerCase()} →
      </Link>
    </div>
  );
}

export function OpenItemsAging({
  findings,
  actions,
}: {
  findings: DashboardSummary["findings"];
  actions:  DashboardSummary["actions"];
}) {
  const findingsOpen = findings.open;
  const actionsOpen  = (actions.open ?? 0) + (actions.in_progress ?? 0);
  const bothEmpty    = findingsOpen === 0 && actionsOpen === 0;

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Open Items Aging
        </p>
        <Link href="/findings" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          View all →
        </Link>
      </div>

      {bothEmpty ? (
        <div className="flex items-center gap-2 py-2">
          <span style={{ color: "#22c55e", fontSize: "18px" }}>✓</span>
          <p className="text-sm" style={{ color: "#86efac" }}>No open items. All clear.</p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
          <AgingSection
            label="Findings"
            href="/findings?status=open"
            open={findingsOpen}
            avgAge={findings.avg_age_days}
            maxAge={findings.max_age_days}
            olderThan30={findings.older_than_30 ?? 0}
            olderThan7={findings.older_than_7 ?? 0}
          />
          <div className="hidden sm:block" style={{ width: "1px", background: SLATE_LINE, flexShrink: 0 }} />
          <AgingSection
            label="Actions"
            href="/actions"
            open={actionsOpen}
            avgAge={actions.avg_age_days}
            maxAge={actions.max_age_days}
            olderThan30={actions.older_than_30 ?? 0}
            olderThan7={actions.older_than_7 ?? 0}
          />
        </div>
      )}
    </div>
  );
}

// ── InventoryGrid ──────────────────────────────────────────────

export function InventoryGrid({
  inventory,
  controls_cadence,
}: {
  inventory: DashboardSummary["inventory"];
  controls_cadence: DashboardSummary["controls_cadence"];
}) {
  const primaryRows: Array<{ label: string; count: number; href: string }> = [
    { label: "Vendors",    count: inventory.vendors,    href: "/vendors" },
    { label: "Controls",   count: inventory.controls,   href: "/controls" },
    { label: "AI Systems", count: inventory.ai_systems, href: "/ai-systems" },
  ];
  const secondaryRows: Array<{ label: string; count: number; href: string }> = [
    { label: "Assessments",  count: inventory.control_assessments, href: "/controls" },
    { label: "Gov. Reviews", count: inventory.governance_reviews,  href: "/ai-systems" },
    { label: "Frameworks",   count: inventory.frameworks,          href: "/frameworks" },
  ];
  if ((inventory.risks ?? 0) > 0)       secondaryRows.push({ label: "Risks",       count: inventory.risks!,       href: "/risks" });
  if ((inventory.obligations ?? 0) > 0) secondaryRows.push({ label: "Obligations", count: inventory.obligations!, href: "/obligations" });

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: TEXT_MUTED }}>
        Inventory
      </p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {primaryRows.map(({ label, count, href }) => (
          <Link
            key={label}
            href={href}
            className="flex flex-col items-center justify-center rounded-lg py-3 hover:opacity-80 transition-opacity"
            style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${SLATE_LINE}` }}
          >
            <span className="text-xl font-bold" style={{ color: TEAL }}>{count}</span>
            <span className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>{label}</span>
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
        {secondaryRows.map(({ label, count, href }) => (
          <div key={label} className="flex items-baseline justify-between">
            <span className="text-xs" style={{ color: "#475569" }}>{label}</span>
            <Link href={href} className="text-xs font-semibold ml-1 hover:opacity-80 transition-opacity" style={{ color: "#94a3b8" }}>
              {count}
            </Link>
          </div>
        ))}
      </div>
      {(controls_cadence?.overdue ?? 0) > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${SLATE_LINE}` }}>
          <Link
            href="/controls?filter=overdue"
            className="flex items-center justify-between text-xs font-medium hover:opacity-80 transition-opacity"
            style={{ color: "#fca5a5" }}
          >
            <span>Controls overdue for testing</span>
            <span className="font-bold">{controls_cadence.overdue}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── VendorRiskCard ─────────────────────────────────────────────

export function VendorRiskCard({
  vendor_risk,
}: {
  vendor_risk: DashboardSummary["vendor_risk"];
}) {
  const vr = vendor_risk ?? {
    by_criticality: { critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0 },
    total: 0,
    high_or_critical: 0,
  };

  const total = vr.total;

  const segments = [
    { key: "critical",      count: vr.by_criticality.critical,      color: "#ef4444" },
    { key: "high",          count: vr.by_criticality.high,          color: "#f97316" },
    { key: "medium",        count: vr.by_criticality.medium,        color: "#f59e0b" },
    { key: "low",           count: vr.by_criticality.low,           color: "#22c55e" },
    { key: "uncategorized", count: vr.by_criticality.uncategorized, color: "#334155" },
  ].filter((s) => s.count > 0);

  let accumulated = 0;

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Vendor Risk
        </p>
        <Link href="/vendors/risk" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          Risk report →
        </Link>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <p className="text-xs" style={{ color: TEXT_MUTED }}>No vendors added yet.</p>
          <Link href="/vendors/new" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
            Add vendor →
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-5">
          <div className="flex-shrink-0">
            <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} width={DONUT_SIZE} height={DONUT_SIZE}>
              <circle cx={DONUT_C} cy={DONUT_C} r={DONUT_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={DONUT_STROKE} />
              {segments.map(({ key, count, color }) => {
                const arc = (count / total) * DONUT_CIRC;
                const offset = -accumulated;
                accumulated += arc;
                return (
                  <circle
                    key={key}
                    cx={DONUT_C} cy={DONUT_C} r={DONUT_R}
                    fill="none" stroke={color} strokeWidth={DONUT_STROKE}
                    strokeDasharray={`${arc} ${DONUT_CIRC - arc}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${DONUT_C} ${DONUT_C})`}
                    strokeLinecap="butt"
                  />
                );
              })}
              <text x={DONUT_C} y={DONUT_C - 4} textAnchor="middle" fill="#f1f5f9" fontSize="24" fontWeight="700">
                {total}
              </text>
              <text x={DONUT_C} y={DONUT_C + 16} textAnchor="middle" fill={TEXT_MUTED} fontSize="11">
                vendors
              </text>
            </svg>
          </div>
          <div className="flex-1 space-y-2">
            {(["critical", "high", "medium", "low"] as const).map((level) => {
              const count = vr.by_criticality[level];
              const c = CRIT_COLORS[level]!;
              return (
                <Link
                  key={level}
                  href={`/vendors?criticality=${level}`}
                  className="flex items-center gap-2 text-xs hover:opacity-80 transition-opacity"
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.bar }} />
                  <span style={{ color: "#94a3b8" }}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </span>
                  <span className="ml-auto font-bold tabular-nums" style={{ color: count > 0 ? "#f1f5f9" : TEXT_MUTED }}>
                    {count}
                  </span>
                </Link>
              );
            })}
            {vr.high_or_critical > 0 && (
              <p className="text-xs pt-1" style={{ color: "#fca5a5", borderTop: `1px solid ${SLATE_LINE}` }}>
                {vr.high_or_critical} high-risk vendor{vr.high_or_critical !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PostureScoreTile ───────────────────────────────────────────

export function PostureScoreTile({
  posture,
}: {
  posture: DashboardSummary["posture"];
}) {
  const score = posture.overall_score;
  const severity = posture.overall_severity;
  const date = posture.snapshot_date;

  const severityColor =
    severity === "Low"      ? "#86efac" :
    severity === "Moderate" ? "#fcd34d" :
    severity === "High"     ? "#fdba74" :
    severity === "Critical" ? "#fca5a5" :
    TEXT_MUTED;

  const badgeStyle: React.CSSProperties =
    severity === "Low"      ? { background: "rgba(34,197,94,0.15)",   color: severityColor } :
    severity === "Moderate" ? { background: "rgba(245,158,11,0.15)",  color: severityColor } :
    severity === "High"     ? { background: "rgba(249,115,22,0.15)",  color: severityColor } :
    severity === "Critical" ? { background: "rgba(239,68,68,0.15)",   color: severityColor } :
    { background: "rgba(100,116,139,0.12)", color: severityColor };

  const formattedDate = date
    ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div
      className="rounded-xl border p-5 flex flex-col justify-between"
      style={{ background: SURFACE, borderColor: SLATE_LINE, borderLeft: `4px solid ${TEAL}` }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: TEXT_MUTED }}>
        Posture Score
      </p>
      {score == null ? (
        <div>
          <p className="text-2xl font-bold mb-1" style={{ color: TEXT_MUTED }}>—</p>
          <p className="text-xs" style={{ color: TEXT_MUTED }}>No snapshot yet. Run a posture snapshot to see your score.</p>
        </div>
      ) : (
        <>
          <p className="text-4xl font-bold leading-none" style={{ color: severityColor }}>{score}</p>
          <div className="mt-2 flex items-center gap-2">
            {severity && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={badgeStyle}>
                {severity}
              </span>
            )}
          </div>
          {formattedDate && (
            <p className="mt-2 text-xs" style={{ color: TEXT_MUTED }}>as of {formattedDate}</p>
          )}
        </>
      )}
      <Link href="/posture" className="block mt-3 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
        Full posture →
      </Link>
    </div>
  );
}

// ── RisksBreakdown ─────────────────────────────────────────────

export function RisksBreakdown({
  risks_summary,
}: {
  risks_summary: DashboardSummary["risks_summary"];
}) {
  const rs = risks_summary ?? { open: 0, by_risk_rating: { Critical: 0, High: 0, Moderate: 0, Low: 0 } };
  const total = rs.open;

  const bars = [
    { label: "Critical", count: rs.by_risk_rating.Critical, color: "#ef4444" },
    { label: "High",     count: rs.by_risk_rating.High,     color: "#f97316" },
    { label: "Moderate", count: rs.by_risk_rating.Moderate, color: "#f59e0b" },
    { label: "Low",      count: rs.by_risk_rating.Low,      color: "#22c55e" },
  ];

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Open Risks
        </p>
        <Link href="/risks" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          View all →
        </Link>
      </div>
      <p className="text-3xl font-bold mb-3" style={{ color: total > 0 ? "#f1f5f9" : TEXT_MUTED }}>
        {total}
      </p>
      <div className="space-y-2.5">
        {bars.map(({ label, count, color }) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: "#94a3b8" }}>{label}</span>
                <span className="text-xs font-bold tabular-nums" style={{ color: count > 0 ? color : TEXT_MUTED }}>{count}</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── RiskHeatmap ────────────────────────────────────────────────

const LIKELIHOOD_LEVELS = [
  "very_likely",
  "likely",
  "possible",
  "unlikely",
  "rare",
] as const;

const IMPACT_LEVELS = [
  "Low",
  "Moderate",
  "High",
  "Critical",
] as const;

const LIKELIHOOD_LABELS: Record<string, string> = {
  very_likely: "Very Likely",
  likely:      "Likely",
  possible:    "Possible",
  unlikely:    "Unlikely",
  rare:        "Rare",
};

// Matrix indexed [likelihoodIdx][impactIdx], values: "red" | "amber" | "green"
// likelihood rows: very_likely=0, likely=1, possible=2, unlikely=3, rare=4
// impact cols:     Low=0, Moderate=1, High=2, Critical=3
const CELL_ZONE: ReadonlyArray<ReadonlyArray<"red" | "amber" | "green">> = [
  ["amber", "red",   "red",   "red"  ], // very_likely
  ["green", "amber", "red",   "red"  ], // likely
  ["green", "amber", "amber", "red"  ], // possible
  ["green", "green", "amber", "amber"], // unlikely
  ["green", "green", "green", "amber"], // rare
];

const ZONE_STYLE = {
  red:   { bg: "rgba(239,68,68,0.25)",   border: "rgba(239,68,68,0.5)"   },
  amber: { bg: "rgba(245,158,11,0.20)",  border: "rgba(245,158,11,0.4)"  },
  green: { bg: "rgba(34,197,94,0.15)",   border: "rgba(34,197,94,0.3)"   },
};

function cellZone(likelihood: string, impact: string): "red" | "amber" | "green" {
  const li = LIKELIHOOD_LEVELS.indexOf(likelihood as typeof LIKELIHOOD_LEVELS[number]);
  const ii = IMPACT_LEVELS.indexOf(impact as typeof IMPACT_LEVELS[number]);
  if (li < 0 || ii < 0) return "green";
  return CELL_ZONE[li]![ii]!;
}

export function RiskHeatmap({
  risks_summary,
}: {
  risks_summary: DashboardSummary["risks_summary"];
}) {
  const cells = risks_summary?.by_likelihood_impact ?? [];

  const cellMap = new Map<string, number>();
  for (const c of cells) {
    cellMap.set(`${c.likelihood}|${c.impact}`, c.count);
  }

  const hasData = cells.length > 0;

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Risk Heatmap
        </p>
        <Link href="/risks" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          All risks →
        </Link>
      </div>

      {!hasData ? (
        <CompactEmptyState
          message="No risk data available."
          ctaLabel="Open risk register →"
          ctaHref="/risks"
        />
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
            {/* Y-axis labels */}
            <div style={{ display: "flex", flexDirection: "column", width: "72px", flexShrink: 0 }}>
              {LIKELIHOOD_LEVELS.map((lh) => (
                <div
                  key={lh}
                  style={{ height: "34px", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "6px" }}
                >
                  <span style={{ fontSize: "9px", color: TEXT_MUTED, textAlign: "right", lineHeight: 1.2 }}>
                    {LIKELIHOOD_LABELS[lh]}
                  </span>
                </div>
              ))}
            </div>

            {/* Grid + X-axis */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display:               "grid",
                  gridTemplateColumns:   "repeat(4, 1fr)",
                  gridTemplateRows:      "repeat(5, 34px)",
                  gap:                   "2px",
                }}
              >
                {LIKELIHOOD_LEVELS.map((lh) =>
                  IMPACT_LEVELS.map((imp) => {
                    const count = cellMap.get(`${lh}|${imp}`) ?? 0;
                    const zone  = cellZone(lh, imp);
                    const { bg, border } = ZONE_STYLE[zone];
                    return (
                      <div
                        key={`${lh}|${imp}`}
                        title={`${LIKELIHOOD_LABELS[lh]} × ${imp}: ${count} risk${count !== 1 ? "s" : ""}`}
                        style={{
                          background:     bg,
                          border:         `1px solid ${border}`,
                          borderRadius:   "3px",
                          display:        "flex",
                          alignItems:     "center",
                          justifyContent: "center",
                          fontSize:       "13px",
                          fontWeight:     700,
                          color:          count > 0 ? "#f1f5f9" : "transparent",
                          cursor:         count > 0 ? "default" : "default",
                        }}
                      >
                        {count > 0 ? count : "·"}
                      </div>
                    );
                  })
                )}
              </div>

              {/* X-axis labels */}
              <div
                style={{
                  display:             "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap:                 "2px",
                  marginTop:           "4px",
                }}
              >
                {IMPACT_LEVELS.map((imp) => (
                  <div key={imp} style={{ textAlign: "center" }}>
                    <span style={{ fontSize: "9px", color: TEXT_MUTED }}>{imp}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FrameworkGaps ──────────────────────────────────────────────

export function FrameworkGaps({
  pairs,
}: {
  pairs: Array<{ framework: Framework; readiness: FrameworkReadiness | null }>;
}) {
  const sorted = [...pairs]
    .filter((p) => p.readiness !== null)
    .sort((a, b) => (a.readiness?.readiness_score ?? 0) - (b.readiness?.readiness_score ?? 0))
    .slice(0, 3);

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Framework Gaps
        </p>
        <Link href="/frameworks" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          All frameworks →
        </Link>
      </div>
      {sorted.length === 0 ? (
        <CompactEmptyState
          message="No frameworks activated yet."
          ctaLabel="Add framework →"
          ctaHref="/frameworks"
        />
      ) : (
        <div className="space-y-4">
          {sorted.map(({ framework, readiness }) => {
            const score     = readiness?.readiness_score   ?? 0;
            const satisfied = readiness?.satisfied         ?? 0;
            const partial   = readiness?.partial           ?? 0;
            const unmapped  = readiness?.unmapped          ?? 0;
            const color     = scoreColor(score);
            const breakdown = [
              satisfied > 0 ? `${satisfied} satisfied` : null,
              partial   > 0 ? `${partial} partial`     : null,
              unmapped  > 0 ? `${unmapped} unmapped`   : null,
            ].filter(Boolean);
            return (
              <div key={framework.id}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-medium truncate max-w-[160px]" style={{ color: "#cbd5e1" }}>
                    {framework.name}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-xs font-bold tabular-nums" style={{ color }}>{score}%</span>
                    <Link
                      href={`/frameworks/${framework.id}`}
                      className="text-xs font-medium hover:opacity-80 transition-opacity"
                      style={{ color: TEAL }}
                    >
                      View →
                    </Link>
                  </div>
                </div>
                <div className="h-2 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-2 rounded-full" style={{ width: `${score}%`, background: color }} />
                </div>
                {breakdown.length > 0 && (
                  <p className="mt-1 text-xs" style={{ color: TEXT_MUTED }}>
                    {breakdown.join(" • ")}
                  </p>
                )}
              </div>
            );
          })}
          {pairs.length > 3 && (
            <p className="text-xs" style={{ color: TEXT_MUTED }}>+{pairs.length - 3} more frameworks</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── ComplianceCoverage ─────────────────────────────────────────

export function ComplianceCoverage({
  frameworkPairs,
}: {
  frameworkPairs: Array<{ framework: Framework; readiness: FrameworkReadiness | null }>;
}) {
  const pairs = frameworkPairs.filter((p) => p.readiness !== null);

  const totalSatisfied    = pairs.reduce((sum, p) => sum + (p.readiness?.satisfied         ?? 0), 0);
  const totalRequirements = pairs.reduce((sum, p) => sum + (p.readiness?.total_requirements ?? 0), 0);
  const overallPct = totalRequirements > 0
    ? Math.round((totalSatisfied / totalRequirements) * 100)
    : null;

  const sorted = [...pairs].sort(
    (a, b) => (b.readiness?.readiness_score ?? 0) - (a.readiness?.readiness_score ?? 0)
  );

  return (
    <div className="rounded-xl border p-5 h-full flex flex-col" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Compliance Coverage
        </p>
        <Link href="/frameworks" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          All frameworks →
        </Link>
      </div>

      {/* Single empty state when no frameworks have been assessed.
          Pre-fix: both the aggregate-number block AND the per-framework
          block emitted "No frameworks assessed yet" simultaneously,
          rendering the message twice on the same card. The aggregate
          block now renders only when there's actual data; the empty
          state collapses into the compact CTA path below. */}
      {sorted.length === 0 ? (
        <CompactEmptyState
          message="No frameworks assessed yet."
          ctaLabel="Add framework →"
          ctaHref="/frameworks"
        />
      ) : (
        <>
          {/* Aggregate number — only when data exists */}
          {overallPct !== null && (
            <div className="mb-4">
              <p className="text-4xl font-bold leading-none" style={{ color: TEAL }}>
                {overallPct}%
              </p>
              <p className="mt-1 text-xs" style={{ color: "#94a3b8" }}>
                {totalSatisfied} of {totalRequirements} requirements satisfied
              </p>
            </div>
          )}
        <div className="space-y-3">
          {sorted.map(({ framework, readiness }) => {
            const score     = readiness?.readiness_score   ?? 0;
            const satisfied = readiness?.satisfied         ?? 0;
            const total     = readiness?.total_requirements ?? 0;
            const partial   = readiness?.partial           ?? 0;
            const unmapped  = readiness?.unmapped          ?? 0;
            const color =
              score >= 80 ? "#22c55e" :
              score >= 60 ? "#f59e0b" :
              "#ef4444";
            return (
              <div key={framework.id}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs truncate max-w-[120px]" style={{ color: "#cbd5e1" }}>
                    {framework.name}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    <span className="text-xs tabular-nums" style={{ color: TEXT_MUTED }}>
                      {satisfied}/{total}
                    </span>
                    {partial > 0 && (
                      <span className="text-xs" style={{ color: "#f59e0b" }}>
                        {partial} partial
                      </span>
                    )}
                    {unmapped > 0 && (
                      <span className="text-xs" style={{ color: "#475569" }}>
                        {unmapped} unmapped
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-1 rounded-full" style={{ background: SLATE_LINE }}>
                  <div className="h-1 rounded-full" style={{ width: `${Math.min(score, 100)}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
