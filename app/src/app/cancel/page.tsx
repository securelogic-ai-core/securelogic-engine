import Link from "next/link";

/**
 * /cancel — Post-Stripe-checkout cancellation landing page.
 *
 * Stripe redirects here when the user exits checkout without paying
 * (STRIPE_CANCEL_URL). No session changes are needed — their account
 * is unchanged.
 */
export default function CancelPage() {
  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-slate-900 mb-2">
          Checkout cancelled
        </h1>
        <p className="text-slate-500 text-sm mb-8">
          No charge was made. You can upgrade to Premium at any time from your
          account page.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/account"
            className="bg-teal-600 hover:bg-teal-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            Back to Account
          </Link>
          <Link
            href="/dashboard"
            className="text-slate-500 hover:text-slate-700 text-sm transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
