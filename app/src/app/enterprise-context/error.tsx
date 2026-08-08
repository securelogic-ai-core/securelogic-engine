"use client";

/**
 * Error boundary for the Enterprise Context route group (#693 / DS-12).
 *
 * The app previously had NO error boundary anywhere, so any render throw in
 * this group surfaced as a raw HTTP 500 — which is exactly how the graph
 * page's missing NODE_COLORS entry took the whole route down on staging.
 * This boundary degrades a future failure to the group's panel pattern
 * (message + retry + way back) instead of a dead end.
 */

import Link from "next/link";
import { useEffect } from "react";

export default function EnterpriseContextError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server components log the original error with its digest; the client
    // mirror is for local debugging only.
    console.error("enterprise-context render failure", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
        <h1 className="text-lg font-bold mb-2" style={{ color: "#f1f5f9" }}>
          This view hit an error
        </h1>
        <p className="text-sm mb-1" style={{ color: "#94a3b8" }}>
          Something went wrong rendering Enterprise Context. Your data is
          unaffected — this is a display failure.
        </p>
        {error.digest && (
          <p className="text-xs mb-4 font-mono" style={{ color: "#64748b" }}>
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "rgba(0,196,180,0.15)", border: "1px solid rgba(0,196,180,0.4)", color: "#5eead4" }}
          >
            Try again
          </button>
          <Link
            href="/enterprise-context"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ border: "1px solid #1e293b", color: "#94a3b8" }}
          >
            Back to Enterprise Context
          </Link>
        </div>
      </div>
    </div>
  );
}
