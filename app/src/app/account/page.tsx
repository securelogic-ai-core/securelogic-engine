import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMe } from "@/lib/api";

function planDisplayName(entitlementLevel: string): string {
  switch (entitlementLevel) {
    case "premium":      return "Team";
    case "professional": return "Professional";
    case "admin":        return "Enterprise";
    default:             return "Free";
  }
}

const BILLING_ERRORS: Record<string, string> = {
  checkout_failed: "We couldn't start the checkout session. Please try again or contact support.",
  portal_failed: "We couldn't open the billing portal. Please try again or contact support.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ billing_error?: string }>;
}) {
  const session = await getSession();

  if (!session.apiKey) {
    redirect("/login");
  }

  const me = await getMe(session.apiKey);

  if (!me) {
    redirect("/login");
  }

  const isPaid = me.entitlementLevel === "premium" || me.entitlementLevel === "professional";
  const planName = planDisplayName(me.entitlementLevel);
  const { billing_error: billingError } = await searchParams;
  const billingErrorMessage = billingError ? BILLING_ERRORS[billingError] ?? null : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Account</h1>
        <p className="text-slate-600 text-sm">
          Your organization settings and subscription status.
        </p>
      </div>

      {billingErrorMessage && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-5 py-4">
          <p className="text-sm text-red-700">{billingErrorMessage}</p>
        </div>
      )}

      <div className="space-y-5">
        {/* Organization */}
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Organization
          </h2>
          <dl className="space-y-4">
            <Row label="Name" value={me.organizationName} />
            <Row label="Slug" value={me.organizationSlug} mono />
            <Row label="Plan" value={planName} />
            <Row label="Status" value={me.organizationStatus} />
          </dl>
        </div>

        {/* API Key */}
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            API Key
          </h2>
          <dl className="space-y-4">
            <Row label="Label" value={me.apiKeyLabel ?? "—"} />
            <Row label="Key ID" value={me.apiKeyId} mono />
            <Row label="Status" value={me.apiKeyStatus} />
            <Row
              label="Last used"
              value={
                me.lastUsedAt
                  ? new Date(me.lastUsedAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "Never"
              }
            />
          </dl>
        </div>

        {/* Billing / Entitlement */}
        <div className="bg-white border border-slate-200 rounded-lg p-6">
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
                {me.entitlementLevel === "professional"
                  ? "You have full access to all Professional Intelligence Brief content."
                  : "You have full access to all Intelligence Brief content."}
              </p>
              <form action="/api/billing/portal" method="POST">
                <button
                  type="submit"
                  className="border border-slate-300 hover:border-slate-400 text-slate-700 hover:text-slate-900 text-sm font-medium px-5 py-2 rounded-lg transition-colors"
                >
                  Manage Billing
                </button>
              </form>
            </div>
          ) : (
            <div>
              <p className="text-slate-600 text-sm mb-5">
                Upgrade for full brief content, all sections, and the complete archive.
              </p>
              <div className="space-y-3">
                <form action="/api/billing/checkout" method="POST">
                  <input type="hidden" name="tier" value="professional" />
                  <button
                    type="submit"
                    className="w-full border border-teal-600 text-teal-600 hover:bg-teal-50 text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
                  >
                    Upgrade to Professional — $39/mo
                  </button>
                </form>
                <form action="/api/billing/checkout" method="POST">
                  <input type="hidden" name="tier" value="team" />
                  <button
                    type="submit"
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
                  >
                    Upgrade to Team — $209/mo
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Sign out */}
        <div className="flex justify-end">
          <form action="/api/logout" method="POST">
            <button
              type="submit"
              className="text-slate-500 hover:text-red-600 text-sm transition-colors"
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
