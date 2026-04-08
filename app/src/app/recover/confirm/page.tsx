"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"claiming" | "success" | "expired" | "error">("claiming");

  useEffect(() => {
    if (!token) {
      setStatus("expired");
      return;
    }

    let cancelled = false;

    async function claim() {
      try {
        const res = await fetch("/api/account/recover/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;

        if (res.ok) {
          setStatus("success");
        } else {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setStatus(
            body.error === "token_not_found_or_expired" ? "expired" : "error"
          );
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    claim();
    return () => { cancelled = true; };
  }, [token]);

  // Auto-redirect to dashboard on success
  useEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1500);
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <div className="max-w-lg mx-auto px-6 py-20 text-center">
      <div className="bg-white border border-slate-200 rounded-lg p-10">
        {status === "claiming" && (
          <>
            <div className="w-12 h-12 rounded-full border-4 border-teal-200 border-t-teal-600 animate-spin mx-auto mb-6" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">Signing you in…</h1>
            <p className="text-slate-500 text-sm">Verifying your link, please wait.</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Signed in</h1>
            <p className="text-slate-500 text-sm mb-4">
              Welcome back. Redirecting to your dashboard…
            </p>
            <Link
              href="/dashboard"
              className="inline-block bg-teal-600 hover:bg-teal-700 text-white font-semibold px-8 py-2.5 rounded-lg transition-colors text-sm"
            >
              Go to Dashboard →
            </Link>
          </>
        )}

        {status === "expired" && (
          <>
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Link expired</h1>
            <p className="text-slate-500 text-sm mb-6">
              This sign-in link has expired or already been used. Request a new one.
            </p>
            <Link
              href="/recover"
              className="inline-block bg-teal-600 hover:bg-teal-700 text-white font-semibold px-8 py-2.5 rounded-lg transition-colors text-sm"
            >
              Request new link
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h1>
            <p className="text-slate-500 text-sm mb-6">
              We couldn&apos;t sign you in. Please try again.
            </p>
            <Link
              href="/recover"
              className="inline-block bg-teal-600 hover:bg-teal-700 text-white font-semibold px-8 py-2.5 rounded-lg transition-colors text-sm"
            >
              Try again
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function RecoverConfirmPage() {
  return (
    <Suspense>
      <ConfirmContent />
    </Suspense>
  );
}
