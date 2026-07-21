import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssues, getLatestBrief, getMe, getDashboardSummary, getAuthMe, getPostureHistory, getFindings, getFindingsSummary, getFrameworks, getFrameworkReadiness, getActionsSummary, planDisplayName, type Framework, type FrameworkReadiness } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";
import { IntelligenceBriefDashboardCard } from "@/components/IntelligenceBriefDashboardCard";
import { UpgradeCard } from "@/components/UpgradeCard";
import { BillingPortalForm } from "@/components/BillingPortalForm";
import { PostureDashboard } from "./PostureDashboard";
import { CoverageBar } from "@/lib/frameworkCoverage";
import { LastLoginBanner } from "./LastLoginBanner";
import { IndustryTemplatesBanner } from "./IndustryTemplatesBanner";
import { CompactEmptyState } from "./DashboardCharts";
import { dashboardPanel, pendingReviewTile } from "./dashboardState";
import { RecentFindings } from "./RecentFindings";
import { TheBriefing } from "./briefing/TheBriefing";
import { composeBriefing } from "@/lib/briefing/composeBriefing";
import { resolveEligibleModules } from "@/lib/briefing/resolveBriefing";

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
  const [me, issuesData, latestBrief, dashboardSummary, authMe, postureHistory, findingsSummaryData] = await Promise.all([
    getMe(token),
    getIssues(token),
    getLatestBrief(token),
    getDashboardSummary(token),
    session.jwtToken ? getAuthMe(session.jwtToken) : Promise.resolve(null),
    getPostureHistory(token, 90),
    // Session-scoped findings summary — carries my_pending_reviews_open (the
    // reviewer's OWN queue count) alongside the org-wide populations. Fetched so
    // the Pending-Review tile can lead with the viewer's number instead of
    // presenting the org-wide total under a personal-sounding label.
    getFindingsSummary(token),
  ]);

  const entitlementLevelEarly = me?.entitlementLevel ?? "starter";
  const isPlatformEarly = ["premium", "platform", "team"].includes(entitlementLevelEarly);

  // Briefing Initiative B1 — dark flag. OFF (the default everywhere but staging)
  // renders the legacy dashboard byte-for-byte; ON swaps the platform-tier
  // composition for The Briefing (personal work first, explicit scope chips).
  const briefingEnabled = process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED === "true";
  // Briefing-only fetch — REUSES the existing GET /api/actions/summary (the
  // Metric Contract my_open_count / my_overdue_count fields) for the My Work
  // module. Never fetched on the legacy path, so flag-off behavior is unchanged.
  const actionsSummary =
    briefingEnabled && isPlatformEarly ? await getActionsSummary(token) : null;
  const [recentFindingsData, frameworksData] = isPlatformEarly
    ? await Promise.all([
        getFindings(token, { active: true, limit: 5 }),
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
  const planName = planDisplayName(entitlementLevel, me?.stripeSubscriptionTier);
  const displayName = session.name ?? me?.organizationName ?? session.organizationName ?? null;
  const orgName = me?.organizationName ?? session.organizationName;

  // D-2: the org has posture data when ANY platform object exists — a posture
  // snapshot, an open finding/action/risk, a computed domain, or an activated
  // framework. The "complete setup to start tracking posture" nudge must not show
  // to a tenant that is already tracking posture. (If a tenant's entitlement is
  // mis-seeded, that is an operator/data concern — the dashboard's own signals are
  // kept internally consistent so it cannot contradict itself.)
  const hasPlatformData = Boolean(
    (postureHistory?.snapshots?.length ?? 0) > 0 ||
      dashboardSummary?.posture?.snapshot_date ||
      (dashboardSummary?.findings?.open ?? 0) > 0 ||
      (dashboardSummary?.actions?.open ?? 0) > 0 ||
      (dashboardSummary?.domains?.length ?? 0) > 0 ||
      recentFindings.length > 0 ||
      frameworks.length > 0 ||
      (dashboardSummary?.risks_summary?.open ?? 0) > 0,
  );

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
              {/* A platform tenant just bought the platform, not "brief access" —
                  the copy must match what they purchased. */}
              {isPlatformUser
                ? `Your account has been upgraded. ${planName} is now active.`
                : "Your account has been upgraded. Full brief access is now enabled."}
            </p>
          </div>
        </div>
      )}

      {/* Industry templates banner — first 7 days, dismissible.
          Self-gates on env var + user state; renders null when not applicable. */}
      <IndustryTemplatesBanner authMe={authMe} />

      {/* Onboarding banner — only when setup is genuinely incomplete (D-2): a
          tenant already tracking posture must not be told to "complete setup". */}
      {isPlatformUser && !onboardingCompleted && !hasPlatformData && (
        <OnboardingBanner />
      )}

      {/* Briefing Initiative B1: flag ON + platform tier → The Briefing replaces
          the composition below. Flag OFF (or a non-platform tier, which keeps the
          brief-centric page and the sample-dashboard upsell) → the legacy page,
          byte-for-byte. The entitlement branch is load-bearing: dashboardSummary
          is fetched for every tier, so only THIS branch keeps platform UI from
          leaking to Brief-only tiers. */}
      {briefingEnabled && isPlatformUser ? (
        <TheBriefing
          displayName={displayName}
          orgName={orgName}
          planName={planName}
          modules={resolveEligibleModules({
            isPlatformUser,
            // JWT sessions carry a user identity; legacy API-key sessions do not
            // — their personal modules are omitted (never zeroed).
            hasUserIdentity: Boolean(session.jwtToken && session.userId),
            flags: {
              independent_review:
                process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED === "true",
            },
          })}
          vm={composeBriefing({
            summary: dashboardSummary,
            findingsSummary: findingsSummaryData?.summary ?? null,
            actionsSummary,
          })}
          latestBrief={latestBrief}
          latestIssue={latestIssue}
          issuesCount={issuesData?.count ?? 0}
          recentFindings={recentFindings}
          summaryActiveFindings={dashboardSummary?.findings?.open ?? 0}
        />
      ) : (
        <>
      {/* Welcome */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-slate-100 mb-1">
          Welcome back{displayName ? `, ${displayName}` : ""}.
        </h1>
        {/* D-1 / D-4: separate enterprise platform framing from consumer newsletter
            framing. A platform/enterprise tenant is not a "Brief Lite" subscriber and
            must not be addressed as one. */}
        <p className="text-slate-400 text-sm">
          {isPlatformUser
            ? `You have ${planName} access to the SecureLogic platform.`
            : isPaid
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

          {latestBrief ? (
            <IntelligenceBriefDashboardCard brief={latestBrief} />
          ) : latestIssue ? (
            // Legacy newsletter-issue fallback (no intelligence brief yet).
            // viewerIsPlatform: a platform tenant must never see the Free/
            // Brief Pro teaser even if the engine returns locked (drift →
            // neutral unavailable card). showStaleWarning: this is a "Latest
            // Brief" surface — an old issue must declare its age.
            <BriefCard
              issue={latestIssue}
              viewerIsPlatform={isPlatformUser}
              showStaleWarning
            />
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

      {/* Governance-review callout (finding-lifecycle-spec §1.3). Count-scope fix
          (2026-07-20): the org-wide ready-for-decision population and the viewer's
          OWN review queue (review_owner=me) are the same predicate at two scopes —
          this tile previously showed the ORG-WIDE number under the personal queue's
          label, telling a reviewer with 1 assigned review that "5" were pending.
          pendingReviewTile() (pure, unit-tested) now picks the variant:
            personal — lead with the viewer's number, org total as labeled context;
            org      — explicitly organization-wide (leadership view). */}
      {isPlatformUser &&
        (() => {
          const tile = pendingReviewTile(
            dashboardSummary?.findings?.pending_independent_review ?? 0,
            findingsSummaryData?.summary?.my_pending_reviews_open ?? null,
            process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED === "true",
          );
          if (!tile) return null;
          return (
            <div className="mt-10">
              <Link
                href={tile.href}
                className="flex items-center justify-between rounded-xl border px-5 py-4 transition-colors hover:bg-white/[0.02]"
                style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(139,92,246,0.35)" }}
              >
                {tile.variant === "personal" ? (
                  <>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "#c4b5fd" }}>
                        My Pending Reviews
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
                        Assigned to you to validate and close
                        {tile.orgWide > tile.mine
                          ? ` · ${tile.orgWide} organization-wide ready to close`
                          : ""}
                      </p>
                    </div>
                    <span className="text-2xl font-bold tabular-nums" style={{ color: "#c4b5fd" }}>
                      {tile.mine}
                    </span>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "#c4b5fd" }}>
                        Ready to Close
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
                        Organization-wide — remediation complete, governance decision pending
                      </p>
                    </div>
                    <span className="text-2xl font-bold tabular-nums" style={{ color: "#c4b5fd" }}>
                      {tile.orgWide}
                    </span>
                  </>
                )}
              </Link>
            </div>
          );
        })()}

      {/* Recent Findings — platform subscribers only */}
      {isPlatformUser && (
        <div className="mt-10">
          <RecentFindings findings={recentFindings} summaryActiveCount={dashboardSummary?.findings?.open ?? 0} />
        </div>
      )}

      {/* Framework Readiness — platform subscribers only */}
      {isPlatformUser && (
        <div className="mt-10">
          <FrameworkReadinessWidget pairs={frameworkReadinessPairs} />
        </div>
      )}

      {/* Posture Dashboard — platform subscribers only.
          A failed summary fetch (null) must render an EXPLICIT error, not
          silently drop the panel — otherwise a load failure is indistinguishable
          from an org that genuinely has no data (a zeros object still renders). */}
      {(() => {
        const panel = dashboardPanel(isPlatformUser, dashboardSummary !== null);
        if (panel === "sample") {
          return (
            <div className="mt-10">
              <SamplePostureDashboard />
            </div>
          );
        }
        if (panel === "error") {
          return (
            <div className="mt-10">
              <div
                className="rounded-xl border p-8 text-center"
                style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(239,68,68,0.25)" }}
              >
                <p className="text-sm font-semibold mb-1" style={{ color: "#fca5a5" }}>
                  We couldn&apos;t load your posture data.
                </p>
                <p className="text-xs" style={{ color: "#64748b" }}>
                  This is a temporary problem loading your dashboard — it does not mean your
                  posture is clear. Refresh to try again.
                </p>
              </div>
            </div>
          );
        }
        return (
          <div className="mt-10">
            <PostureDashboard
              summary={dashboardSummary!}
              frameworkPairs={frameworkReadinessPairs}
              postureSnapshots={postureHistory?.snapshots ?? []}
              userRole={session.userRole ?? "viewer"}
            />
          </div>
        );
      })()}
        </>
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

function ManageBillingButton() {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
        Billing
      </h3>
      <BillingPortalForm
        label="Manage Billing"
        buttonClassName="w-full text-sm text-slate-200 hover:text-white border border-brand-line hover:border-slate-500 font-medium py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      />
      <p className="mt-2 text-xs text-slate-400 text-center">
        Upgrade, downgrade, or cancel anytime
      </p>
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
              <p className="text-[11px] text-slate-500 mb-1">Health score · higher = better</p>
              <p className="text-4xl font-bold text-slate-100 leading-none">67</p>
              <span className="mt-2 self-start inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-900/40 text-amber-300">
                Moderate
              </span>
              <p className="mt-2 text-xs text-slate-500">as of Apr 14, 2026</p>
            </div>

            {/* Active findings */}
            <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Active Findings</p>
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
            <input type="hidden" name="tier" value="platform" />
            <button
              type="submit"
              className="inline-flex items-center gap-2 bg-teal-700 hover:bg-teal-600 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
            >
              Upgrade to Platform Professional — $800/mo
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Recent Findings lives in ./RecentFindings.tsx (shared with The Briefing).
// ─────────────────────────────────────────────────────────────

function FrameworkReadinessWidget({
  pairs,
}: {
  pairs: Array<{ framework: Framework; readiness: FrameworkReadiness | null }>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
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
      {/* D-5: distinguish from Compliance Coverage below — this is how close each
          activated framework is to audit-ready, not the share of requirements met. */}
      <p className="text-xs mb-4" style={{ color: "#64748b" }}>
        How close each activated framework is to being audit-ready.
      </p>

      {pairs.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl">
          <CompactEmptyState
            message="No frameworks activated yet."
            ctaLabel="Activate a framework →"
            ctaHref="/frameworks"
          />
        </div>
      ) : (
        <div className="bg-brand-surface border border-brand-line rounded-xl divide-y" style={{ "--tw-divide-opacity": "1" } as React.CSSProperties}>
          {pairs.map(({ framework, readiness }) => {
            const score = readiness?.readiness_score ?? 0;
            const color =
              score >= 80 ? "#22c55e" :
              score >= 60 ? "#f59e0b" :
              score >= 40 ? "#f97316" :
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
                  {/* Item-7 ruling: the engine's coverage caption, verbatim —
                      the score is satisfied-only, and this line is what makes
                      a low score beside visible partial work read as fact. */}
                  <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                    v{framework.version}
                    {readiness ? <> · {readiness.coverage_caption}</> : null}
                  </p>
                </div>
                <div className="w-32 flex items-center gap-2 flex-shrink-0">
                  {/* Shared segmented bar: solid = fully satisfied, hatched = partial. */}
                  <div className="flex-1">
                    <CoverageBar
                      satisfied={readiness?.satisfied ?? 0}
                      partial={readiness?.partial ?? 0}
                      total={readiness?.total_requirements ?? 0}
                      heightClass="h-1.5"
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

