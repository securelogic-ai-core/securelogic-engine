import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMe, getAuthMe, getSubscription, planDisplayName } from "@/lib/api";
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

/**
 * Formats a Stripe price (amount in the smallest currency unit + interval) into
 * a display string like "$800/mo" or "$7,200/yr". Returns null when the amount
 * is unknown (e.g. the Stripe-unavailable fallback), so callers can omit the
 * dollar figure rather than show a hardcoded one.
 */
function formatSubscriptionPrice(
  amount: number | null,
  currency: string | null,
  interval: string | null,
): string | null {
  if (amount === null || amount === undefined) return null;
  const dollars = amount / 100;
  const money = dollars.toLocaleString("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
  });
  const per = interval === "year" ? "/yr" : interval === "month" ? "/mo" : "";
  return `${money}${per}`;
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
  const [me, authMe, subscription] = await Promise.all([
    getMe(token),
    session.jwtToken ? getAuthMe(session.jwtToken) : null,
    getSubscription(token),
  ]);

  if (!me) {
    redirect("/login");
  }

  const userRole      = authMe?.role ?? session.userRole ?? "admin";
  const userName      = authMe?.name ?? session.name ?? "";
  const userEmail     = authMe?.email ?? session.email ?? "";
  const isPaid        = me.entitlementLevel === "premium" || me.entitlementLevel === "professional";
  // ── Delinquency visibility (SL-BILL-1 D1) ──────────────────────────────
  // Keyed on the payment_failed_at stamp from GET /api/billing/subscription —
  // the authoritative dunning signal, written by invoice.payment_failed and
  // cleared only by a successful grant. It must NOT be inferred from the
  // entitlement level: Stripe's past_due update downgrades the org to
  // 'starter', so the previous `entitlementLevel !== "starter"` conjunct was
  // unsatisfiable exactly when the customer was locked out and needed telling.
  // billingActive alone is no substitute either — it is false for every free
  // org, which never had a payment to fail.
  const hasPaymentFailure = Boolean(subscription?.payment_failed_at);

  // ── The three billing states (SL-BILL-1 PR-H) ──────────────────────────
  // grace_state comes from the ENGINE, computed by the same graceWindow
  // function the request path enforces with and the dunning emails are worded
  // from. It is NOT re-derived here: three implementations of one rule is two
  // too many, and the one that drifts is the one the customer reads.
  //
  // The states differ in what the customer can DO, which is the whole point:
  //
  //   in_grace  — the subscription is still live and Stripe is still retrying,
  //               so updating the card fixes it. The PORTAL is the right action.
  //   suspended — under ruling P6 the end of dunning CANCELS the subscription,
  //               and a cancelled subscription cannot be revived by a card
  //               update: the portal has nothing left to update. Sending them
  //               there is a dead end at the exact moment they are trying to
  //               pay us. CHECKOUT is the right action.
  const graceState = subscription?.grace_state ?? (hasPaymentFailure ? "lapsed" : "healthy");
  const inGrace = hasPaymentFailure && graceState === "in_grace";
  const isSuspended = hasPaymentFailure && graceState === "lapsed";
  const graceEndsLabel = subscription?.grace_ends_at
    ? new Date(subscription.grace_ends_at).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
    : null;
  // The plan to offer back. The tier they last held, so a returning Platform
  // customer is not silently offered Brief Pro.
  const resubscribeTier =
    me.stripeSubscriptionTier === "platform_annual" ? "platform_annual"
    : me.stripeSubscriptionTier === "teams" ? "teams"
    : me.stripeSubscriptionTier === "professional" ? "professional"
    : "platform";
  const resubscribeLabel = planDisplayName(
    resubscribeTier === "professional" || resubscribeTier === "teams" ? "professional" : "premium",
    resubscribeTier,
  );
  const isPlatform    = isPaid;
  const isAdmin       = userRole === "admin";
  const planName      = planDisplayName(me.entitlementLevel, me.stripeSubscriptionTier);

  // ── Trial status (display only) ────────────────────────────────────────
  // Sourced from the live Stripe subscription via GET /api/billing/subscription
  // (trial_end + amount are authoritative there; DB fallback derives trial_end
  // from trial_started_at + TRIAL_PERIOD_DAYS). On conversion day Stripe flips
  // status trialing → active and this block naturally stops rendering.
  const isTrialing  = subscription?.status === "trialing";
  const trialEndDate = isTrialing && subscription?.trial_end ? new Date(subscription.trial_end) : null;
  const trialDaysLeft = trialEndDate
    ? Math.max(0, Math.ceil((trialEndDate.getTime() - Date.now()) / 86_400_000))
    : null;
  const trialUrgent = isTrialing && trialDaysLeft !== null && trialDaysLeft <= 3;
  const trialEndLabel = trialEndDate
    ? trialEndDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  // Amount comes straight off the subscribed price — never hardcoded.
  const trialAmountLabel = formatSubscriptionPrice(
    subscription?.amount ?? null,
    subscription?.currency ?? null,
    subscription?.interval ?? null,
  );
  const daysLeftText = trialDaysLeft === null
    ? null
    : trialDaysLeft === 1 ? "1 day left" : `${trialDaysLeft} days left`;

  // ── Renewal visibility (#692 A9, display only) ─────────────────────────
  // current_period_end + amount/interval come from the same live Stripe read
  // as the trial block. Rendered only for an active subscription: trialing
  // shows the trial block instead, and none/canceled shows neither.
  const isActiveSub = subscription?.status === "active";
  const renewDate = isActiveSub && subscription?.current_period_end
    ? new Date(subscription.current_period_end)
    : null;
  const renewDateLabel = renewDate
    ? renewDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const renewAmountLabel = isActiveSub
    ? formatSubscriptionPrice(
        subscription?.amount ?? null,
        subscription?.currency ?? null,
        subscription?.interval ?? null,
      )
    : null;
  const renewLabel = renewDateLabel
    ? renewAmountLabel ? `${renewDateLabel} · ${renewAmountLabel}` : renewDateLabel
    : null;
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

      {inGrace && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-5 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-900 mb-1">Payment failed</p>
            <p className="text-sm text-amber-800">
              We couldn&apos;t process your last payment. {graceEndsLabel
                ? <>Your access continues until <strong>{graceEndsLabel}</strong> — update your payment method before then and nothing will be interrupted.</>
                : <>Update your payment method to keep your access uninterrupted.</>}
            </p>
          </div>
          {isAdmin && (
            <BillingPortalForm
              label="Update Payment Method"
              formClassName="flex-shrink-0"
              buttonClassName="text-sm font-semibold text-amber-900 border border-amber-300 hover:border-amber-500 px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            />
          )}
        </div>
      )}

      {isSuspended && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-red-800 mb-1">Your access is suspended</p>
              <p className="text-sm text-red-700">
                We couldn&apos;t collect payment, so your subscription ended.{" "}
                <strong>Nothing has been deleted</strong> — your findings, vendors,
                assessments and history are exactly where you left them and return the
                moment you subscribe again.
              </p>
            </div>
            {isAdmin && (
              // Checkout, NOT the portal. The subscription is cancelled: there
              // is no payment method left to update, and the portal would be a
              // dead end for a customer trying to give us money.
              <form action="/api/billing/checkout" method="POST" className="flex-shrink-0">
                <input type="hidden" name="tier" value={resubscribeTier} />
                <button
                  type="submit"
                  className="bg-red-700 hover:bg-red-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                >
                  Resubscribe to {resubscribeLabel}
                </button>
              </form>
            )}
          </div>
          {!isAdmin && (
            <p className="mt-2 text-xs text-red-600">
              Ask an admin in your organization to restore the subscription.
            </p>
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
            {renewLabel && <Row label="Renews" value={renewLabel} />}
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
            {isTrialing ? (
              <span className="text-amber-700 text-sm font-medium">
                Free Trial{daysLeftText ? ` — ${daysLeftText}` : ""}
                {trialEndLabel ? ` (converts to ${planName} on ${trialEndLabel})` : ""}
              </span>
            ) : isPaid ? (
              <span className="text-slate-500 text-sm">Active subscription</span>
            ) : null}
          </div>

          {isPaid ? (
            <div>
              {isTrialing ? (
                <div
                  className={`mb-4 rounded-lg border p-4 ${
                    trialUrgent ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      trialUrgent ? "text-red-800" : "text-amber-900"
                    }`}
                  >
                    {trialUrgent
                      ? `Your trial ends in ${daysLeftText ?? "under a day"} — you'll be charged ${
                          trialAmountLabel ?? "your plan price"
                        }${trialEndLabel ? ` on ${trialEndLabel}` : ""} unless you cancel.`
                      : `You're on a free trial with full Platform access${
                          daysLeftText ? ` — ${daysLeftText}` : ""
                        }.${
                          trialAmountLabel && trialEndLabel
                            ? ` Converts to ${trialAmountLabel} on ${trialEndLabel}.`
                            : ""
                        }`}
                  </p>
                  <p className={`text-xs mt-1 ${trialUrgent ? "text-red-700" : "text-amber-700"}`}>
                    Cancel anytime before then and you won&apos;t be charged.
                  </p>
                </div>
              ) : (
                <p className="text-slate-600 text-sm mb-4">
                  Active subscription. Full access to all Intelligence Brief content.
                </p>
              )}
              {isAdmin && (
                <BillingPortalForm
                  label={isTrialing ? "Manage billing" : "Manage Billing"}
                  buttonClassName={
                    trialUrgent
                      ? "border border-red-400 bg-white hover:bg-red-50 text-red-700 hover:text-red-800 text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      : "border border-slate-300 hover:border-slate-400 text-slate-700 hover:text-slate-900 text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  }
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
                      Brief Team — $199/mo
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
