"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /billing-return — Post-Stripe-portal landing page.
 *
 * Stripe redirects here after a customer manages their subscription in the
 * Customer Portal (STRIPE_PORTAL_RETURN_URL). Refreshes the session cookie
 * once so the account page reflects any tier changes, then redirects to
 * /account regardless of refresh outcome.
 */
export default function BillingReturnPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function refreshAndRedirect() {
      try {
        await fetch("/api/session/refresh", { method: "POST" });
      } catch {
        // Refresh failure is non-fatal — /account will read whatever the
        // session cookie currently has, and the user can re-trigger from there.
      }
      if (!cancelled) router.push("/account");
    }

    refreshAndRedirect();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10">
        <div className="w-12 h-12 rounded-full border-4 border-teal-200 border-t-teal-600 animate-spin mx-auto mb-6" />
        <h1 className="text-xl font-bold text-slate-900 mb-2">
          Updating your subscription…
        </h1>
        <p className="text-slate-500 text-sm">
          One moment while we refresh your account.
        </p>
      </div>
    </div>
  );
}
