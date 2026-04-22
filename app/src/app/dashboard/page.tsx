import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssues, getMe, getDashboardSummary, getAuthMe, getPostureHistory, getFindings, getFrameworks, getFrameworkReadiness, type DashboardSummary, type PostureSnapshot, type Finding, type Framework, type FrameworkReadiness } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";
import { UpgradeCard } from "@/components/UpgradeCard";
import { FindingsDonut, DomainPostureBars, ActionsRing, InventoryGrid, FrameworkGaps, VendorRiskCard, PostureScoreTile, RisksBreakdown, ComplianceCoverage, RiskHeatmap } from "./DashboardCharts";
import { PostureTrendChart } from "./PostureTrendChart";
import { LastLoginBanner } from "./LastLoginBanner";

export const revalidate = 0;

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
  // getAuthMe() provides user-level data (including suppression status) for JWT sessions.
  const [me, issuesData, dashboardSummary, authMe, postureHistory] = await Promise.all([
    getMe(token),
    getIssues(token),
    getDashboardSummary(token),
    session.jwtToken ? getAuthMe(session.jwtToken) : Promise.resolve(null),
    getPostureHistory(token, 90),
  ]);

  const entitlementLevelEarly = me?.entitlementLevel ?? "starter";
  const isPlatformEarly = ["premium", "platform", "team"].includes(entitlementLevelEarly);
  const [recentFindingsData, frameworksData] = isPlatformEarly
    ? await Promise.all([
        getFindings(token, { status: "open", limit: 5 }),
        getFrameworks(token),
      ])
    : [null, null];
  const recentFindings = recentFindingsData?.findings ?? [];

  const frameworks = frameworksData?.frameworks ?? [];
  const frameworkReadinessResults = frameworks.length > 0
    ? await Promise.all(frameworks.map((f) => getFrameworkReadiness(token, f.id)))
    : [];
  const frameworkReadinessPairs: Array<{ framework: Framework; readiness: FrameworkReadiness | null }> =
    frameworks.map((f, i) => ({ framework: f, readiness: frameworkReadinessResults[i] ?? null }));

  const latestIssue = issuesData?.issues?.[0] ?? null;
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const onboardingCompleted = session.onboardingCompleted ?? false;
  const isPaid = ["premium", "professional", "platform", "team"].includes(entitlementLevel);
  const emailSuppressed = (authMe?.emailSuppressed ?? false) && isPaid;
  // Platform access: full posture dashboard, vendor/AI/controls features
  const isPlatformUser = entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  const isTeamTier = entitlementLevel === "team";
  const isPlatformPro = entitlementLevel === "premium" || entitlementLevel === "platform";
  const isBriefPro = entitlementLevel === "professional";
  const planName = planDisplayName(entitlementLevel);
  const displayName = session.name ?? me?.organizationName ?? session.organizationName ?? null;
  const orgName = me?.organizationName ?? session.organizationName;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <LastLoginBanner previousLoginAt={authMe?.previousLoginAt ?? null} />

      {/* Email suppression warning — paid subscriber not receiving briefs */}
      {emailSuppressed && (
        <div className="mb-6 bg-red-950/50 border border-red-700/60 rounded-xl px-5 py-4 flex items-start gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-red-300 font-semibold text-sm">⚠️ Your email address is not receiving briefs.</p>
            <p className="text-red-400/80 text-xs mt-1">
              Your subscription is active but brief delivery is blocked. Please contact{" "}
              <a href="mailto:hello@securelogicai.com" className="underline hover:text-red-300">
                hello@securelogicai.com
              </a>{" "}
              to resolve this.
            </p>
          </div>
        </div>
      )}

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

      {/* Onboarding banner — shown until onboarding is complete */}
      {isPlatformUser && !onboardingCompleted && (
        <OnboardingBanner />
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
                    isTeamTier
                      ? "bg-purple-900/40 text-purple-300"
                      : isPlatformPro
                      ? "bg-teal-800/50 text-teal-200 ring-1 ring-teal-700/50"
                      : isBriefPro
                      ? "bg-teal-900/40 text-teal-300"
                      : "bg-slate-700/40 text-slate-300"
                  }`}
                >
                  {planName}
                </span>
              </div>
            </div>
          </div>

          {/* Billing card — paid users */}
          {isPaid && <ManageBillingButton />}

          {/* Upgrade card — free and Brief Pro users (not Platform) */}
          {!isPlatformUser && <UpgradeCard entitlementLevel={entitlementLevel} />}
        </div>
      </div>

      {/* Recent Findings — platform subscribers only */}
      {isPlatformUser && (
        <div className="mt-10">
          <RecentFindings findings={recentFindings} summaryOpenCount={dashboardSummary?.findings?.open ?? 0} />
        </div>
      )}

      {/* Framework Readiness — platform subscribers only */}
      {isPlatformUser && (
        <div className="mt-10">
          <FrameworkReadinessWidget pairs={frameworkReadinessPairs} />
        </div>
      )}

      {/* Posture Dashboard — platform subscribers only */}
      {isPlatformUser ? (
        dashboardSummary && (
          <div className="mt-10">
            <PostureDashboard summary={dashboardSummary} frameworkPairs={frameworkReadinessPairs} postureSnapshots={postureHistory?.snapshots ?? []} />
          </div>
        )
      ) : (
        <div className="mt-10">
          <SamplePostureDashboard />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Onboarding banner — shown to platform users until dismissed
// ─────────────────────────────────────────────────────────────

function OnboardingBanner() {
  return (
    <div
      className="mb-6 flex items-center justify-between gap-4 rounded-xl px-5 py-4 flex-wrap"
      style={{
        background: "rgba(0,196,180,0.08)",
        border: "1px solid rgba(0,196,180,0.3)",
      }}
    >
      <div>
        <p className="text-sm font-semibold mb-0.5" style={{ color: "#00c4b4" }}>
          🚀 Get started
        </p>
        <p className="text-xs" style={{ color: "#94a3b8" }}>
          Complete your security program setup to start tracking your posture.
        </p>
      </div>
      <Link
        href="/getting-started"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold flex-shrink-0 transition-colors"
        style={{ background: "#00c4b4", color: "#0a0f1a" }}
      >
        Continue Setup →
      </Link>
    </div>
  );
}

function planDisplayName(entitlementLevel: string): string {
  switch (entitlementLevel) {
    case "professional":    return "Brief Pro";
    case "premium":
    case "platform":        return "Platform Professional";
    case "team":            return "Platform Team";
    case "free":
    case "starter":
    default:                return "Free";
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
      <p className="mt-2 text-xs text-slate-400 text-center">
        Upgrade, downgrade, or cancel anytime
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Posture Dashboard — Layer 5: posture-dashboard-ui
// Consumes GET /api/dashboard/summary (Layer 4, closed).
// ─────────────────────────────────────────────────────────────


function PostureDashboard({
  summary,
  frameworkPairs,
  postureSnapshots,
}: {
  summary: DashboardSummary;
  frameworkPairs: Array<{ framework: Framework; readiness: FrameworkReadiness | null }>;
  postureSnapshots: PostureSnapshot[];
}) {
  const { posture, domains, findings, actions, controls_cadence, inventory, vendor_risk, risks_summary } = summary;

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
        Security Posture
      </h2>

      {/* Row 0: Posture score | Risks breakdown | Risk heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <PostureScoreTile posture={posture} />
        <RisksBreakdown risks_summary={risks_summary} />
        <RiskHeatmap risks_summary={risks_summary} />
      </div>

      {/* Row 0b: Posture score trend (full width) */}
      <div className="mb-4">
        <PostureTrendChart snapshots={postureSnapshots} />
      </div>

      {/* Row 1: Findings donut | Domain bars | Actions ring */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <FindingsDonut findings={findings} />
        <DomainPostureBars domains={domains} />
        <ActionsRing actions={actions} />
      </div>

      {/* Row 2: Vendor risk | Framework gaps | Compliance coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <VendorRiskCard vendor_risk={vendor_risk} />
        <FrameworkGaps pairs={frameworkPairs} />
        <ComplianceCoverage frameworkPairs={frameworkPairs} />
      </div>

      {/* Row 3: Inventory grid (full width) */}
      <InventoryGrid inventory={inventory} controls_cadence={controls_cadence} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sample Posture Dashboard — shown to non-Platform subscribers
// Displays fake data with a preview banner so users can see
// what Platform Professional looks like before upgrading.
// ─────────────────────────────────────────────────────────────

function SamplePostureDashboard() {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
        Security Posture
      </h2>

      {/* Preview banner */}
      <div className="mb-4 bg-amber-900/30 border border-amber-700/50 rounded-xl px-5 py-3 flex items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber-400 flex-shrink-0">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
        </svg>
        <p className="text-amber-200 text-sm">
          <span className="font-semibold">SAMPLE PREVIEW</span> — This is a preview of Platform Professional. Your real data appears after upgrade.
        </p>
      </div>

      {/* Sample tiles — blurred to indicate preview */}
      <div className="relative">
        <div className="pointer-events-none select-none" style={{ filter: "blur(1.5px)", opacity: 0.75 }}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">

            {/* Posture score */}
            <div className="lg:col-span-1 bg-brand-surface border border-brand-line rounded-xl p-5 flex flex-col justify-between">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Posture Score</p>
              <p className="text-4xl font-bold text-slate-100 leading-none">67</p>
              <span className="mt-2 self-start inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-900/40 text-amber-300">
                Moderate
              </span>
              <p className="mt-2 text-xs text-slate-500">as of Apr 14, 2026</p>
            </div>

            {/* Open findings */}
            <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Open Findings</p>
              <p className="text-3xl font-bold text-slate-100">4</p>
              <div className="mt-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                  <span>Critical</span>
                  <span className="ml-auto font-medium">1</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
                  <span>High</span>
                  <span className="ml-auto font-medium">2</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                  <span>Moderate</span>
                  <span className="ml-auto font-medium">1</span>
                </div>
              </div>
            </div>

            {/* Open actions */}
            <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Open Actions</p>
              <p className="text-3xl font-bold text-slate-100">3</p>
              <p className="mt-2 text-xs font-semibold text-red-400">1 overdue</p>
            </div>

            {/* Inventory */}
            <div className="lg:col-span-2 bg-brand-surface border border-brand-line rounded-xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Inventory</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {[
                  { label: "Vendors",      count: 8 },
                  { label: "AI Systems",   count: 3 },
                  { label: "Controls",     count: 12 },
                  { label: "Assessments",  count: 5 },
                  { label: "Gov. Reviews", count: 2 },
                ].map(({ label, count }) => (
                  <div key={label} className="flex items-baseline justify-between">
                    <span className="text-xs text-slate-400">{label}</span>
                    <span className="text-sm font-semibold text-slate-100 ml-2">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Upgrade CTA */}
        <div className="mt-4 text-center">
          <form action="/api/billing/checkout" method="POST">
            <input type="hidden" name="tier" value="team" />
            <button
              type="submit"
              className="inline-flex items-center gap-2 bg-teal-700 hover:bg-teal-600 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
            >
              Upgrade to Platform Professional — $799/mo
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Recent Findings — compact list for platform dashboard
// ─────────────────────────────────────────────────────────────

const SEVERITY_BADGE_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",  color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",  color: "#86efac" },
};

const SOURCE_COMPACT_LABELS: Record<string, string> = {
  vendor_review:        "Vendor",
  control_test:         "Control",
  obligation_review:    "Obligation",
  ai_review:            "AI Review",
  ai_governance_review: "AI Gov",
  manual:               "Manual",
  assessment:           "Assessment",
  signal:               "Signal",
  risk:                 "Risk",
};

function FrameworkReadinessWidget({
  pairs,
}: {
  pairs: Array<{ framework: Framework; readiness: FrameworkReadiness | null }>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
          Framework Readiness
        </h2>
        <Link
          href="/frameworks"
          className="text-xs font-medium transition-colors"
          style={{ color: "#00c4b4" }}
        >
          {pairs.length === 0 ? "Add Framework →" : "View all →"}
        </Link>
      </div>

      {pairs.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm mb-2" style={{ color: "#94a3b8" }}>
            No frameworks activated yet.
          </p>
          <Link href="/frameworks" className="text-xs font-medium hover:underline" style={{ color: "#00c4b4" }}>
            Activate a framework →
          </Link>
        </div>
      ) : (
        <div className="bg-brand-surface border border-brand-line rounded-xl divide-y" style={{ "--tw-divide-opacity": "1" } as React.CSSProperties}>
          {pairs.map(({ framework, readiness }) => {
            const score = readiness?.readiness_score ?? 0;
            const color =
              score >= 75 ? "#22c55e" :
              score >= 50 ? "#f59e0b" :
              score >= 25 ? "#f97316" :
              "#ef4444";
            return (
              <Link
                key={framework.id}
                href={`/frameworks/${framework.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors"
                style={{ borderColor: "#1e293b" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "#f1f5f9" }}>
                    {framework.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                    v{framework.version}
                  </p>
                </div>
                <div className="w-32 flex items-center gap-2 flex-shrink-0">
                  <div className="flex-1 rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${score}%`, background: color }}
                    />
                  </div>
                  <span className="text-xs font-bold tabular-nums w-8 text-right" style={{ color }}>
                    {score}%
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentFindings({ findings, summaryOpenCount }: { findings: Finding[]; summaryOpenCount: number }) {
  const noFindings = findings.length === 0;
  const summaryConfirmsZero = summaryOpenCount === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
          Recent Findings
        </h2>
        <Link
          href="/findings"
          className="text-xs font-medium transition-colors"
          style={{ color: "#00c4b4" }}
        >
          View all findings →
        </Link>
      </div>

      {noFindings ? (
        summaryConfirmsZero ? (
          <div
            className="rounded-xl border p-6 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(34,197,94,0.2)" }}
          >
            <p className="text-sm" style={{ color: "#86efac" }}>
              No open findings. Your organization is in good shape.
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl border p-6 text-center"
            style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
          >
            <p className="text-sm mb-2" style={{ color: "#94a3b8" }}>
              Could not load recent findings.
            </p>
            <Link href="/findings" className="text-xs font-medium" style={{ color: "#00c4b4" }}>
              View all findings →
            </Link>
          </div>
        )
      ) : (
        <div
          className="rounded-xl border divide-y"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b", "--tw-divide-opacity": "1" } as React.CSSProperties}
        >
          {findings.map((f) => {
            const sevStyle = SEVERITY_BADGE_STYLES[f.severity ?? ""] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
            const sourceLabel = SOURCE_COMPACT_LABELS[f.source_type] ?? f.source_type;
            return (
              <div
                key={f.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderColor: "#1e293b" }}
              >
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold shrink-0"
                  style={sevStyle}
                >
                  {f.severity}
                </span>
                <span className="text-sm font-medium flex-1 truncate" style={{ color: "#f1f5f9" }}>
                  {f.title}
                </span>
                <span
                  className="text-xs shrink-0 px-2 py-0.5 rounded"
                  style={{ background: "rgba(148,163,184,0.08)", color: "#64748b" }}
                >
                  {f.domain ?? sourceLabel}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
