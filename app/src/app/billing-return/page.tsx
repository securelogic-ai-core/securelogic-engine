"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * /billing-return — Post-Stripe-portal landing page.
 *
 * Stripe redirects here after a customer manages their subscription in the
 * Customer Portal (STRIPE_PORTAL_RETURN_URL). Polls /api/session/refresh
 * until the engine reports a different entitlement than the first response
 * (the "before" baseline), then redirects to /account. If the entitlement
 * never changes within the polling window, redirects anyway so the user is
 * not stranded on this page after a no-op portal visit.
 */
export default function BillingReturnPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const fromParam = searchParams.get("from");
    let cancelled = false;
    let attempts = 0;
    let baseline: string | null | undefined =
      fromParam !== null ? fromParam : undefined;
    const MAX_ATTEMPTS = 10;
    const POLL_MS = 1500;

    function redirect() {
      if (!cancelled) router.push("/account");
    }

    async function poll() {
      if (cancelled) return;

      attempts++;

      try {
        const res = await fetch("/api/session/refresh", { method: "POST" });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const level: string | null = data?.entitlementLevel ?? null;

          if (baseline === undefined) {
            baseline = level;
          } else if (level !== baseline) {
            // Engine has reported a new entitlement — portal change applied.
            redirect();
            return;
          }
        }
      } catch {
        // Network/refresh failure on a single attempt is non-fatal — keep
        // polling until either the entitlement changes or we exhaust attempts.
      }

      if (attempts >= MAX_ATTEMPTS) {
        redirect();
        return;
      }

      setTimeout(poll, POLL_MS);
    }

    // Initial delay so the portal-driven subscription update has time to
    // propagate to the engine before the first /api/me read.
    const timer = setTimeout(poll, POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router, searchParams]);

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
