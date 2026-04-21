"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RecalculateScoreButton({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleRecalculate() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/vendors/${vendorId}/risk-score`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Recalculation failed");
          return;
        }
        router.refresh();
      } catch {
        setError("Network error — please try again");
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleRecalculate}
        disabled={isPending}
        className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-medium border transition-opacity disabled:opacity-50 hover:opacity-80"
        style={{ borderColor: "#1e2d45", color: "#00c4b4", background: "transparent" }}
      >
        {isPending ? (
          <>
            <svg
              className="animate-spin"
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Recalculating…
          </>
        ) : (
          "Recalculate Score"
        )}
      </button>
      {error && (
        <p className="mt-1.5 text-xs text-center" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </div>
  );
}
