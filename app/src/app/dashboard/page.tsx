import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getIssues, getMe } from "@/lib/api";
import { BriefCard } from "@/components/BriefCard";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  // Fetch live account data and issues in parallel.
  // getMe() is the source of truth for entitlement — never rely on the
  // session cookie alone, which may be stale after a Stripe upgrade.
  const [me, issuesData] = await Promise.all([
    getMe(session.apiKey),
    getIssues(session.apiKey),
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
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
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
          <div className="bg-white border border-slate-200 rounded-lg p-5">
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

          {/* Quick links */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Quick links
            </h3>
            <div className="space-y-2">
              <Link
                href="/briefs"
                className="block text-sm text-slate-700 hover:text-teal-600 transition-colors"
              >
                → Brief archive
              </Link>
              <Link
                href="/account"
                className="block text-sm text-slate-700 hover:text-teal-600 transition-colors"
              >
                → Account settings
              </Link>
            </div>
          </div>
        </div>
      </div>
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
    <div className="bg-teal-600 text-white rounded-lg p-5">
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
    <div className="bg-white border border-slate-200 rounded-lg p-5">
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
