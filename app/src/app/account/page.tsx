import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMe, getAuthMe, planDisplayName } from "@/lib/api";
import { BillingPortalForm } from "@/components/BillingPortalForm";
import MfaSection from "./security/MfaSection";
import ChangePasswordSection from "./security/ChangePasswordSection";

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    admin:   { bg: "rgba(139,92,246,0.15)",  color: "#c4b5fd" },
    analyst: { bg: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
    viewer:  { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  };
  const s = styles[role] ?? styles.viewer!;
  return (
    <span
      style={{
        display: "inline-inline",
        background: s.bg,
        color: s.color,
        fontSize: "11px",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "20px",
      }}
    >
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

const BILLING_ERRORS: Record<string, string> = {
  checkout_failed: "We couldn't start the checkout session. Please try again or contact support.",
  portal_failed: "We couldn't open the billing portal. Please try again or contact support.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ billing_error?: string; reason?: string; mfa_required?: string }>;
}) {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  // Prefer JWT-auth /api/auth/me for richer data when available
  const [me, authMe] = await Promise.all([
    getMe(token),
    session.jwtToken ? getAuthMe(session.jwtToken) : null,
  ]);

  if (!me) {
    redirect("/login");
  }

  const userRole      = authMe?.role ?? session.userRole ?? "admin";
  const userName      = authMe?.name ?? session.name ?? "";
  const userEmail     = authMe?.email ?? session.email ?? "";
  const isPaid        = me.entitlementLevel === "premium" || me.entitlementLevel === "professional";
  const hasPaymentFailure = me.billingActive === false && me.entitlementLevel !== "starter";
  const isPlatform    = isPaid;
  const isAdmin       = userRole === "admin";
  const planName      = planDisplayName(me.entitlementLevel, me.stripeSubscriptionTier);
  const { billing_error: billingError, reason: billingReason, mfa_required: mfaRequired } = await searchParams;
  const billingErrorMessage = billingError ? BILLING_ERRORS[billingError] ?? null : null;
  const showMfaBanner = mfaRequired === "1";

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Account &amp; Billing</h1>
        <p className="text-slate-600 text-sm">
          Subscription, access key, and organization details.
        </p>
      </div>

      {hasPaymentFailure && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-5 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-red-800 mb-1">Payment failed</p>
            <p className="text-sm text-red-700">
              Your last payment could not be processed. Please update your billing details to restore full access.
            </p>
          </div>
          {isAdmin && (
            <BillingPortalForm
              label="Update Billing"
              formClassName="flex-shrink-0"
              buttonClassName="text-sm font-semibold text-red-700 border border-red-300 hover:border-red-500 px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            />
          )}
        </div>
      )}

      {billingErrorMessage && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-5 py-4">
          <p className="text-sm text-red-700">{billingErrorMessage}</p>
          {billingReason && (
            <p className="mt-1 text-xs text-red-600 font-mono break-all">
              Reason: {billingReason}
            </p>
          )}
        </div>
      )}

      <div className="space-y-5">
        {/* User Profile */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Your Account
          </h2>
          <dl className="space-y-4">
            {userName && <Row label="Name" value={userName} />}
            {userEmail && <Row label="Email" value={userEmail} />}
            <div className="flex items-start justify-between gap-4">
              <dt className="text-sm text-slate-500 flex-shrink-0 w-28">Role</dt>
              <dd className="text-sm text-right">
                <RoleBadge role={userRole} />
              </dd>
            </div>
          </dl>
        </div>

        {/* Organization */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Organization
          </h2>
          <dl className="space-y-4">
            <Row label="Name" value={me.organizationName} />
            <Row label="Plan" value={planName} />
          </dl>
        </div>

        {/* Team */}
        {isPlatform && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
              Team
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Manage your team members, roles, and invitations.
            </p>
            <Link
              href="/account/team"
              className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
            >
              {isAdmin ? "Manage Team →" : "View Team →"}
            </Link>
          </div>
        )}

        {/* MFA enrollment required banner — shown when org requires MFA but user hasn't enrolled */}
        {showMfaBanner && session.jwtToken && (
          <div
            style={{
              background: "rgba(217,119,6,0.1)",
              border: "1px solid rgba(217,119,6,0.35)",
              borderRadius: "12px",
              padding: "16px 20px",
            }}
          >
            <p style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 700, color: "#fbbf24" }}>
              Your organisation requires two-factor authentication
            </p>
            <p style={{ margin: 0, fontSize: "13px", color: "#fcd34d", lineHeight: "1.5" }}>
              Please set up 2FA below to continue. You will not be able to sign in until MFA is enabled.
            </p>
          </div>
        )}

        {/* Security / MFA — only available with JWT auth (email/password login) */}
        {session.jwtToken && (
          <MfaSection totpEnabled={authMe?.totpEnabled ?? false} />
        )}

        {/* Change password — only available with JWT auth (email/password login) */}
        {session.jwtToken && (
          <ChangePasswordSection />
        )}

        {/* Alert Preferences */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Alert Preferences
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Configure which email alerts you receive for findings, daily digests, and weekly posture summaries.
          </p>
          <Link
            href="/account/alerts"
            className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
          >
            Manage Alerts →
          </Link>
        </div>

        {/* Privacy & Your Data — self-service GDPR/CCPA export. Not tier-gated:
            data-subject rights apply to every account. */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Privacy &amp; Your Data
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Download a copy of the personal data we hold about you.
          </p>
          <Link
            href="/account/privacy"
            className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
          >
            Privacy &amp; Your Data →
          </Link>
        </div>

        {/* API Keys */}
        {isPlatform && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
              API Keys
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Manage your API keys and view usage.
            </p>
            <Link
              href="/account/api-keys"
              className="text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
            >
              Manage API Keys →
            </Link>
          </div>
        )}

        {/* Billing / Entitlement */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Subscription
          </h2>

          <div className="flex items-center gap-3 mb-6">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
                isPaid
                  ? "bg-teal-100 text-teal-800"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {planName}
            </span>
            {isPaid && (
              <span className="text-slate-500 text-sm">Active subscription</span>
            )}
          </div>

          {isPaid ? (
            <div>
              <p className="text-slate-600 text-sm mb-4">
                Active subscription. Full access to all Intelligence Brief content.
              </p>
              {isAdmin && (
                <BillingPortalForm
                  label="Manage Billing"
                  buttonClassName="border border-slate-300 hover:border-slate-400 text-slate-700 hover:text-slate-900 text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                />
              )}
              {!isAdmin && (
                <p className="text-xs text-slate-400">Only admins can manage billing.</p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-slate-600 text-sm mb-5">
                Subscribe for full brief access — all sections, risk-scored findings, and the complete archive.
              </p>
              {isAdmin ? (
                <div className="space-y-3">
                  <form action="/api/billing/checkout" method="POST">
                    <input type="hidden" name="tier" value="professional" />
                    <button
                      type="submit"
                      className="w-full border border-teal-600 text-teal-600 hover:bg-teal-50 text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
                    >
                      Brief Pro — $49/mo
                    </button>
                  </form>
                  <form action="/api/billing/checkout" method="POST">
                    <input type="hidden" name="tier" value="teams" />
                    <button
                      type="submit"
                      className="w-full border border-teal-600 text-teal-600 hover:bg-teal-50 text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
                    >
                      Team Professional — $199/mo
                    </button>
                  </form>
                  <form action="/api/billing/checkout" method="POST">
                    <input type="hidden" name="tier" value="platform" />
                    <button
                      type="submit"
                      className="w-full bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
                    >
                      Platform Professional — $800/mo
                    </button>
                  </form>
                  <form action="/api/billing/checkout" method="POST">
                    <input type="hidden" name="tier" value="platform_annual" />
                    <button
                      type="submit"
                      className="w-full bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
                    >
                      Platform Annual — $600/mo billed annually
                    </button>
                  </form>
                  <p className="text-xs text-slate-500 pt-1">
                    Platform plans include all Brief features. Any existing Brief
                    subscription will be cancelled automatically on upgrade.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Only admins can manage billing.</p>
              )}
            </div>
          )}
        </div>

        {/* Sign out */}
        <div className="flex justify-end">
          <form action="/api/logout" method="POST">
            <button
              type="submit"
              className="text-slate-400 hover:text-slate-600 text-sm transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm text-slate-500 flex-shrink-0 w-28">{label}</dt>
      <dd
        className={`text-sm text-slate-900 text-right break-all ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
