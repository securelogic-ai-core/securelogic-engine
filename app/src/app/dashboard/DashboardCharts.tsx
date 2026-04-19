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

function scoreColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

// ── FindingsDonut ──────────────────────────────────────────────

export function FindingsDonut({
  findings,
}: {
  findings: DashboardSummary["findings"];
}) {
  const cx = 60, cy = 60, r = 45, sw = 18;
  const CIRC = 2 * Math.PI * r;
  const total = findings.open;

  const segments = (["Critical", "High", "Moderate", "Low"] as const).map((sev) => ({
    sev,
    count: findings.by_severity[sev] ?? 0,
    color: SEVERITY_COLORS[sev]!,
  }));

  let accumulated = 0;

  return (
    <div className="rounded-xl border p-5" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: TEXT_MUTED }}>
        Open Findings
      </p>
      <div className="flex items-center gap-5">
        <div className="flex-shrink-0">
          <svg viewBox="0 0 120 120" width="100" height="100">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
            {total > 0 ? (
              segments.filter((s) => s.count > 0).map(({ sev, count, color }) => {
                const arc = (count / total) * CIRC;
                const offset = -accumulated;
                accumulated += arc;
                return (
                  <circle
                    key={sev}
                    cx={cx} cy={cy} r={r}
                    fill="none" stroke={color} strokeWidth={sw}
                    strokeDasharray={`${arc} ${CIRC - arc}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${cx} ${cy})`}
                    strokeLinecap="butt"
                  />
                );
              })
            ) : (
              <circle
                cx={cx} cy={cy} r={r}
                fill="none" stroke="#22c55e" strokeWidth={sw}
                strokeDasharray={`${CIRC} 0`}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            )}
            <text x={cx} y={cy - 6} textAnchor="middle" fill="#f1f5f9" fontSize="20" fontWeight="700">
              {total}
            </text>
            <text x={cx} y={cy + 10} textAnchor="middle" fill={TEXT_MUTED} fontSize="9">
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
    <div className="rounded-xl border p-5" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Domain Scores
        </p>
        <Link href="/posture" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          Full breakdown →
        </Link>
      </div>
      {domains.length === 0 ? (
        <p className="text-xs" style={{ color: TEXT_MUTED }}>No domain data yet.</p>
      ) : (
        <div className="space-y-3">
          {domains.slice(0, 6).map((d) => {
            const score = d.score ?? 0;
            const color = scoreColor(score);
            return (
              <Link
                key={d.domain}
                href={`/findings?domain=${encodeURIComponent(d.domain)}&status=open`}
                className="block hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs truncate max-w-[140px]" style={{ color: "#cbd5e1" }}>{d.domain}</span>
                  <span className="text-xs font-bold tabular-nums ml-2 flex-shrink-0" style={{ color }}>{score}</span>
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
  const cx = 40, cy = 40, r = 28, sw = 12;
  const CIRC = 2 * Math.PI * r;
  const openCount       = actions.open        ?? 0;
  const inProgressCount = actions.in_progress ?? 0;
  const overdueCount    = actions.overdue      ?? 0;
  const total = openCount + inProgressCount;
  const openArc        = total > 0 ? (openCount        / total) * CIRC : 0;
  const inProgressArc  = total > 0 ? (inProgressCount  / total) * CIRC : 0;

  return (
    <div className="rounded-xl border p-5" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: TEXT_MUTED }}>
        Actions
      </p>
      <div className="flex items-center gap-5">
        <div className="flex-shrink-0">
          <svg viewBox="0 0 80 80" width="80" height="80">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
            {total > 0 ? (
              <>
                {openCount > 0 && (
                  <circle
                    cx={cx} cy={cy} r={r}
                    fill="none" stroke={TEAL} strokeWidth={sw}
                    strokeDasharray={`${openArc} ${CIRC - openArc}`}
                    strokeDashoffset={0}
                    transform={`rotate(-90 ${cx} ${cy})`}
                    strokeLinecap="butt"
                  />
                )}
                {inProgressCount > 0 && (
                  <circle
                    cx={cx} cy={cy} r={r}
                    fill="none" stroke={AMBER} strokeWidth={sw}
                    strokeDasharray={`${inProgressArc} ${CIRC - inProgressArc}`}
                    strokeDashoffset={-openArc}
                    transform={`rotate(-90 ${cx} ${cy})`}
                    strokeLinecap="butt"
                  />
                )}
              </>
            ) : (
              <circle
                cx={cx} cy={cy} r={r}
                fill="none" stroke="#22c55e" strokeWidth={sw}
                strokeDasharray={`${CIRC} 0`}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            )}
            <text x={cx} y={cy - 4} textAnchor="middle" fill="#f1f5f9" fontSize="14" fontWeight="700">
              {total}
            </text>
            <text x={cx} y={cy + 9} textAnchor="middle" fill={TEXT_MUTED} fontSize="8">
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
    <div className="rounded-xl border p-5" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
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

  const cx = 40, cy = 40, r = 28, sw = 12;
  const CIRC = 2 * Math.PI * r;
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
    <div className="rounded-xl border p-5" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
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
            <svg viewBox="0 0 80 80" width="80" height="80">
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
              {segments.map(({ key, count, color }) => {
                const arc = (count / total) * CIRC;
                const offset = -accumulated;
                accumulated += arc;
                return (
                  <circle
                    key={key}
                    cx={cx} cy={cy} r={r}
                    fill="none" stroke={color} strokeWidth={sw}
                    strokeDasharray={`${arc} ${CIRC - arc}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${cx} ${cy})`}
                    strokeLinecap="butt"
                  />
                );
              })}
              <text x={cx} y={cy - 4} textAnchor="middle" fill="#f1f5f9" fontSize="14" fontWeight="700">
                {total}
              </text>
              <text x={cx} y={cy + 9} textAnchor="middle" fill={TEXT_MUTED} fontSize="8">
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
    <div className="rounded-xl border p-5" style={{ background: SURFACE, borderColor: SLATE_LINE }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          Framework Gaps
        </p>
        <Link href="/frameworks" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: TEAL }}>
          All frameworks →
        </Link>
      </div>
      {sorted.length === 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: TEXT_MUTED }}>No frameworks activated yet.</p>
          <Link href="/frameworks" className="text-xs font-medium hover:opacity-80" style={{ color: TEAL }}>
            Add framework →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map(({ framework, readiness }) => {
            const score = readiness?.readiness_score ?? 0;
            const color = scoreColor(score);
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
