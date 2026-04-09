"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function planDisplayName(entitlementLevel: string | null): string {
  switch (entitlementLevel) {
    case "premium":      return "Team";
    case "professional": return "Professional";
    case "admin":        return "Enterprise";
    default:             return "Premium";
  }
}

/**
 * /success — Post-Stripe-checkout landing page.
 *
 * Stripe redirects here after a successful payment (STRIPE_SUCCESS_URL).
 * Polls /api/session/refresh until the entitlement upgrades from the
 * webhook, then auto-redirects to the dashboard.
 */
export default function SuccessPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"refreshing" | "ready" | "error">("refreshing");
  const [planName, setPlanName] = useState<string>("Premium");

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 8;
    const POLL_MS = 1500;

    async function poll() {
      if (cancelled) return;

      try {
        const res = await fetch("/api/session/refresh", { method: "POST" });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const level: string | null = data?.entitlementLevel ?? null;
          const isPaid =
            level === "premium" ||
            level === "professional" ||
            level === "admin";

          if (isPaid) {
            setPlanName(planDisplayName(level));
            setStatus("ready");
            return;
          }
        }

        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          if (!cancelled) setStatus("error");
          return;
        }

        // Entitlement not yet upgraded — webhook still in flight, retry
        setTimeout(poll, POLL_MS);
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    // Initial delay so the Stripe webhook has time to reach the engine
    const timer = setTimeout(poll, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Auto-redirect once session is refreshed
  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(() => router.push("/dashboard"), 1000);
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10">
        {status === "refreshing" && (
          <>
            <div className="w-12 h-12 rounded-full border-4 border-teal-200 border-t-teal-600 animate-spin mx-auto mb-6" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Activating your account…
            </h1>
            <p className="text-slate-500 text-sm">
              Your payment was received. Updating your access now.
            </p>
          </>
        )}

        {status === "ready" && (
          <>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Welcome to {planName}
            </h1>
            <p className="text-slate-500 text-sm mb-6">
              Your subscription is active. You now have full access to the
              Intelligence Brief.
            </p>
            <p className="text-slate-400 text-xs mb-6">Redirecting to your dashboard…</p>
            <Link
              href="/dashboard"
              className="inline-block bg-teal-600 hover:bg-teal-500 text-white font-semibold px-8 py-2.5 rounded-lg transition-colors text-sm"
            >
              Go to Dashboard →
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Payment received
            </h1>
            <p className="text-slate-500 text-sm mb-6">
              Your payment was processed successfully. Your account will reflect
              the upgrade shortly — please visit your dashboard or account page.
            </p>
            <Link
              href="/dashboard"
              className="inline-block bg-teal-600 hover:bg-teal-500 text-white font-semibold px-8 py-2.5 rounded-lg transition-colors text-sm"
            >
              Go to Dashboard →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
