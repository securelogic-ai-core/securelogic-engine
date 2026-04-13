import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssues, getMe, getDashboardSummary, type DashboardSummary } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  // Fetch live account data, issues, and posture summary in parallel.
  // getMe() is the source of truth for entitlement — never rely on the
  // session cookie alone, which may be stale after a Stripe upgrade.
  const [me, issuesData, dashboardSummary] = await Promise.all([
    getMe(session.apiKey),
    getIssues(session.apiKey),
    getDashboardSummary(session.apiKey),
  ]);

  const latestIssue = issuesData?.issues?.[0] ?? null;
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPaid = entitlementLevel === "premium" || entitlementLevel === "professional";
  const planName = planDisplayName(entitlementLevel);
  const orgName = me?.organizationName ?? session.organizationName;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Welcome */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          Welcome back{orgName ? `, ${orgName}` : ""}.
        </h1>
        <p className="text-slate-600 text-sm">
          {isPaid
            ? `You have ${planName} access to the Intelligence Brief.`
            : "You're on the free plan. Upgrade for complete brief content."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Latest brief */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Latest Brief
          </h2>

          {latestIssue ? (
            <BriefCard issue={latestIssue} />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center">
              <p className="text-slate-500 text-sm">
                No briefs published yet. Check back soon.
              </p>
            </div>
          )}

          {issuesData && issuesData.count > 1 && (
            <div className="mt-4">
              <Link
                href="/briefs"
                className="text-teal-600 hover:text-teal-700 text-sm font-medium transition-colors"
              >
                View all {issuesData.count} briefs →
              </Link>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Account status */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Account
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Organization</p>
                <p className="text-sm font-medium text-slate-900">
                  {orgName ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Plan</p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    isPaid
                      ? "bg-teal-100 text-teal-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {planName}
                </span>
              </div>
            </div>
          </div>

          {/* Billing CTA */}
          {isPaid ? (
            <ManageBillingButton />
          ) : (
            <UpgradeCard />
          )}

        </div>
      </div>

      {/* Posture Dashboard — additive section below Brief/Account row.
          Null when org is not entitled or has no snapshots yet. */}
      {dashboardSummary && (
        <div className="mt-10">
          <PostureDashboard summary={dashboardSummary} />
        </div>
      )}
    </div>
  );
}

function planDisplayName(entitlementLevel: string): string {
  switch (entitlementLevel) {
    case "premium":      return "Team";
    case "professional": return "Professional";
    case "admin":        return "Enterprise";
    default:             return "Free";
  }
}

function UpgradeCard() {
  return (
    <div className="bg-teal-600 text-white rounded-xl p-5">
      <h3 className="font-semibold text-sm mb-1">Unlock full access</h3>
      <p className="text-teal-200 text-xs mb-4">
        Full brief content, all sections, and the complete archive.
      </p>
      <div className="space-y-2">
        <form action="/api/billing/checkout" method="POST">
          <input type="hidden" name="tier" value="professional" />
          <button
            type="submit"
            className="w-full bg-teal-500 hover:bg-teal-400 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
          >
            Professional — $39/mo
          </button>
        </form>
        <form action="/api/billing/checkout" method="POST">
          <input type="hidden" name="tier" value="team" />
          <button
            type="submit"
            className="w-full bg-white text-teal-700 hover:bg-teal-50 font-semibold text-sm py-2 rounded-lg transition-colors"
          >
            Team — $209/mo
          </button>
        </form>
      </div>
    </div>
  );
}

function ManageBillingButton() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Billing
      </h3>
      <form action="/api/billing/portal" method="POST">
        <button
          type="submit"
          className="w-full text-sm text-slate-700 hover:text-slate-900 border border-slate-300 hover:border-slate-400 font-medium py-2 rounded-lg transition-colors"
        >
          Manage Billing
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Posture Dashboard — Layer 5: posture-dashboard-ui
// Consumes GET /api/dashboard/summary (Layer 4, closed).
// ─────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { badge: string; bar: string; label: string }> = {
  Critical: { badge: "bg-red-100 text-red-800",    bar: "bg-red-500",    label: "Critical" },
  High:     { badge: "bg-orange-100 text-orange-800", bar: "bg-orange-400", label: "High" },
  Moderate: { badge: "bg-amber-100 text-amber-800",  bar: "bg-amber-400",  label: "Moderate" },
  Low:      { badge: "bg-green-100 text-green-800",  bar: "bg-green-500",  label: "Low" },
};

function severityStyle(s: string | null): { badge: string; bar: string; label: string } {
  if (s && SEVERITY_STYLES[s]) return SEVERITY_STYLES[s]!;
  return { badge: "bg-slate-100 text-slate-600", bar: "bg-slate-300", label: s ?? "—" };
}

function PostureDashboard({ summary }: { summary: DashboardSummary }) {
  const { posture, domains, findings, actions, inventory } = summary;
  const hasSnapshot = posture.overall_score !== null;
  const style = severityStyle(posture.overall_severity);

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
        Security Posture
      </h2>

      {/* Top row: score + 4 stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">

        {/* Overall posture score */}
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Posture Score
          </p>
          {hasSnapshot ? (
            <>
              <p className="text-4xl font-bold text-slate-900 leading-none">
                {posture.overall_score}
              </p>
              <span className={`mt-2 self-start inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${style.badge}`}>
                {style.label}
              </span>
              {posture.snapshot_date && (
                <p className="mt-2 text-xs text-slate-400">
                  as of {new Date(posture.snapshot_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400 mt-2">No snapshot yet</p>
          )}
        </div>

        {/* Open findings */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Open Findings
          </p>
          <p className="text-3xl font-bold text-slate-900">{findings.open}</p>
          <div className="mt-3 space-y-1">
            {(["Critical","High","Moderate","Low"] as const).map((sev) => {
              const count = findings.by_severity[sev] ?? 0;
              if (count === 0) return null;
              const s = severityStyle(sev);
              return (
                <div key={sev} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className={`inline-block w-2 h-2 rounded-full ${s.bar}`} />
                  <span>{sev}</span>
                  <span className="ml-auto font-medium">{count}</span>
                </div>
              );
            })}
            {findings.open === 0 && (
              <p className="text-xs text-slate-400">None open</p>
            )}
          </div>
        </div>

        {/* Open actions */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Open Actions
          </p>
          <p className="text-3xl font-bold text-slate-900">{actions.open}</p>
          {actions.overdue > 0 && (
            <p className="mt-2 text-xs font-semibold text-red-600">
              {actions.overdue} overdue
            </p>
          )}
          {actions.overdue === 0 && actions.open > 0 && (
            <p className="mt-2 text-xs text-slate-400">None overdue</p>
          )}
          {actions.open === 0 && (
            <p className="mt-2 text-xs text-slate-400">None open</p>
          )}
        </div>

        {/* Inventory */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Inventory
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {[
              { label: "Vendors",             count: inventory.vendors },
              { label: "AI Systems",          count: inventory.ai_systems },
              { label: "Controls",            count: inventory.controls },
              { label: "Assessments",         count: inventory.control_assessments },
              { label: "Gov. Reviews",        count: inventory.governance_reviews },
            ].map(({ label, count }) => (
              <div key={label} className="flex items-baseline justify-between">
                <span className="text-xs text-slate-500">{label}</span>
                <span className="text-sm font-semibold text-slate-900 ml-2">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Domain breakdown */}
      {domains.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Domain Breakdown
          </p>
          <div className="space-y-3">
            {domains.map((d) => {
              const s = severityStyle(d.severity);
              const score = d.score ?? 0;
              return (
                <div key={d.domain}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-800">{d.domain}</span>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${s.badge}`}>
                        {s.label}
                      </span>
                      <span className="text-xs text-slate-500 w-7 text-right">{score}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${s.bar}`}
                      style={{ width: `${Math.min(score, 100)}%` }}
                    />
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-slate-400">
                    {d.finding_count > 0 && (
                      <span>{d.finding_count} finding{d.finding_count !== 1 ? "s" : ""}</span>
                    )}
                    {d.action_count > 0 && (
                      <span>{d.action_count} action{d.action_count !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No snapshot yet — instructional state */}
      {!hasSnapshot && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
          <p className="text-sm text-slate-500">
            No posture snapshot exists yet.
            Run a posture snapshot via the API to populate this view.
          </p>
        </div>
      )}
    </div>
  );
}
