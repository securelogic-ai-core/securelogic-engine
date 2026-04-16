import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssues, getMe, getDashboardSummary, type DashboardSummary } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";
import { UpgradeCard } from "@/components/UpgradeCard";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const justUpgraded = params.upgraded === "true";

  // Support both JWT auth (new) and legacy API key auth
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    redirect("/login");
  }

  // Fetch live account data, issues, and posture summary in parallel.
  // getMe() is the source of truth for entitlement — never rely on the
  // session cookie alone, which may be stale after a Stripe upgrade.
  const [me, issuesData, dashboardSummary] = await Promise.all([
    getMe(token),
    getIssues(token),
    getDashboardSummary(token),
  ]);

  const latestIssue = issuesData?.issues?.[0] ?? null;
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPaid = entitlementLevel === "premium" || entitlementLevel === "professional";
  // Platform access: full posture dashboard, vendor/AI/controls features
  const isPlatformUser = entitlementLevel === "premium" || entitlementLevel === "platform";
  const planName = planDisplayName(entitlementLevel);
  const displayName = session.name ?? me?.organizationName ?? session.organizationName ?? null;
  const orgName = me?.organizationName ?? session.organizationName;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Upgrade success banner */}
      {justUpgraded && (
        <div className="mb-6 bg-teal-900/40 border border-teal-700/50 rounded-xl px-5 py-4 flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-brand-teal flex-shrink-0">
            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-teal-200 font-semibold text-sm">Upgrade successful!</p>
            <p className="text-teal-300/80 text-xs mt-0.5">
              Your account has been upgraded. Full brief access is now enabled.
            </p>
          </div>
        </div>
      )}

      {/* Welcome */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-slate-100 mb-1">
          Welcome back{displayName ? `, ${displayName}` : ""}.
        </h1>
        <p className="text-slate-400 text-sm">
          {isPaid
            ? `You have ${planName} access to the Intelligence Brief.`
            : "You're receiving the weekly Intelligence Brief Lite. Upgrade for the full brief."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Latest brief */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
            Latest Brief
          </h2>

          {latestIssue ? (
            <BriefCard issue={latestIssue} />
          ) : (
            <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
              <p className="text-slate-400 text-sm">
                No briefs published yet. Check back soon.
              </p>
            </div>
          )}

          {issuesData && issuesData.count > 1 && (
            <div className="mt-4">
              <Link
                href="/briefs"
                className="text-brand-teal hover:text-teal-300 text-sm font-medium transition-colors"
              >
                View all {issuesData.count} briefs →
              </Link>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Account status */}
          <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Account
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Organization</p>
                <p className="text-sm font-medium text-slate-100">
                  {orgName ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Plan</p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    isPaid
                      ? "bg-teal-900/40 text-teal-300"
                      : "bg-slate-700/40 text-slate-300"
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

      {/* Posture Dashboard — platform subscribers only */}
      {isPlatformUser ? (
        dashboardSummary && (
          <div className="mt-10">
            <PostureDashboard summary={dashboardSummary} />
          </div>
        )
      ) : (
        <div className="mt-10">
          <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Security Posture
            </h2>
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <p className="text-slate-200 text-sm font-semibold mb-1">
                  Upgrade to Platform for posture monitoring
                </p>
                <p className="text-slate-500 text-xs leading-relaxed max-w-lg">
                  Platform Professional includes vendor risk management, AI governance reviews,
                  compliance posture tracking, control assessments, and security scoring.
                </p>
              </div>
              <a
                href="mailto:hello@securelogicai.com?subject=SecureLogic%20AI%20Platform%20Inquiry"
                className="flex-shrink-0 text-xs font-semibold text-brand-teal hover:text-teal-300 transition-colors whitespace-nowrap"
              >
                Platform — $499/mo →
              </a>
            </div>
          </div>
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

function ManageBillingButton() {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
        Billing
      </h3>
      <form action="/api/billing/portal" method="POST">
        <button
          type="submit"
          className="w-full text-sm text-slate-200 hover:text-white border border-brand-line hover:border-slate-500 font-medium py-2 rounded-lg transition-colors"
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
  Critical: { badge: "bg-red-900/40 text-red-300",      bar: "bg-red-500",    label: "Critical" },
  High:     { badge: "bg-orange-900/40 text-orange-300", bar: "bg-orange-400", label: "High" },
  Moderate: { badge: "bg-amber-900/40 text-amber-300",   bar: "bg-amber-400",  label: "Moderate" },
  Low:      { badge: "bg-green-900/40 text-green-300",   bar: "bg-green-500",  label: "Low" },
};

function severityStyle(s: string | null): { badge: string; bar: string; label: string } {
  if (s && SEVERITY_STYLES[s]) return SEVERITY_STYLES[s]!;
  return { badge: "bg-slate-700/40 text-slate-400", bar: "bg-slate-600", label: s ?? "—" };
}

function PostureDashboard({ summary }: { summary: DashboardSummary }) {
  const { posture, domains, findings, actions, inventory } = summary;
  const hasSnapshot = posture.overall_score !== null;
  const style = severityStyle(posture.overall_severity);

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
        Security Posture
      </h2>

      {/* Top row: score + 4 stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">

        {/* Overall posture score */}
        <div className="lg:col-span-1 bg-brand-surface border border-brand-line rounded-xl p-5 flex flex-col justify-between">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Posture Score
          </p>
          {hasSnapshot ? (
            <>
              <p className="text-4xl font-bold text-slate-100 leading-none">
                {posture.overall_score}
              </p>
              <span className={`mt-2 self-start inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${style.badge}`}>
                {style.label}
              </span>
              {posture.snapshot_date && (
                <p className="mt-2 text-xs text-slate-500">
                  as of {new Date(posture.snapshot_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500 mt-2">No snapshot yet</p>
          )}
        </div>

        {/* Open findings */}
        <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Open Findings
          </p>
          <p className="text-3xl font-bold text-slate-100">{findings.open}</p>
          <div className="mt-3 space-y-1">
            {(["Critical","High","Moderate","Low"] as const).map((sev) => {
              const count = findings.by_severity[sev] ?? 0;
              if (count === 0) return null;
              const s = severityStyle(sev);
              return (
                <div key={sev} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className={`inline-block w-2 h-2 rounded-full ${s.bar}`} />
                  <span>{sev}</span>
                  <span className="ml-auto font-medium">{count}</span>
                </div>
              );
            })}
            {findings.open === 0 && (
              <p className="text-xs text-slate-500">None open</p>
            )}
          </div>
        </div>

        {/* Open actions */}
        <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Open Actions
          </p>
          <p className="text-3xl font-bold text-slate-100">{actions.open}</p>
          {actions.overdue > 0 && (
            <p className="mt-2 text-xs font-semibold text-red-400">
              {actions.overdue} overdue
            </p>
          )}
          {actions.overdue === 0 && actions.open > 0 && (
            <p className="mt-2 text-xs text-slate-500">None overdue</p>
          )}
          {actions.open === 0 && (
            <p className="mt-2 text-xs text-slate-500">None open</p>
          )}
        </div>

        {/* Inventory */}
        <div className="lg:col-span-2 bg-brand-surface border border-brand-line rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Inventory
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {[
              { label: "Vendors",      count: inventory.vendors },
              { label: "AI Systems",   count: inventory.ai_systems },
              { label: "Controls",     count: inventory.controls },
              { label: "Assessments",  count: inventory.control_assessments },
              { label: "Gov. Reviews", count: inventory.governance_reviews },
            ].map(({ label, count }) => (
              <div key={label} className="flex items-baseline justify-between">
                <span className="text-xs text-slate-400">{label}</span>
                <span className="text-sm font-semibold text-slate-100 ml-2">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Domain breakdown */}
      {domains.length > 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">
            Domain Breakdown
          </p>
          <div className="space-y-3">
            {domains.map((d) => {
              const s = severityStyle(d.severity);
              const score = d.score ?? 0;
              return (
                <div key={d.domain}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-200">{d.domain}</span>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${s.badge}`}>
                        {s.label}
                      </span>
                      <span className="text-xs text-slate-500 w-7 text-right">{score}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-brand-line rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${s.bar}`}
                      style={{ width: `${Math.min(score, 100)}%` }}
                    />
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-slate-500">
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
        <div className="bg-brand-bg border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm text-slate-400">
            No posture snapshot exists yet.
            Run a posture snapshot via the API to populate this view.
          </p>
        </div>
      )}
    </div>
  );
}
