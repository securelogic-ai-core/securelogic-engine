"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ArchiveVendorButton({
  vendorId,
  vendorName,
}: {
  vendorId: string;
  vendorName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/vendors/${vendorId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Archive failed");
          setConfirming(false);
          return;
        }
        router.push("/vendors");
      } catch {
        setError("Network error — please try again");
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <div
        className="rounded-lg border px-4 py-3 space-y-2"
        style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
      >
        <p className="text-xs" style={{ color: "#fca5a5" }}>
          Mark <strong>{vendorName}</strong> as inactive? This vendor will be hidden from
          active vendor lists.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleArchive}
            disabled={isPending}
            className="px-3 py-1.5 rounded text-xs font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
            style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.4)" }}
          >
            {isPending ? "Archiving…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ color: "#64748b", border: "1px solid #1e293b", background: "transparent" }}
          >
            Cancel
          </button>
        </div>
        {error && (
          <p className="text-xs" style={{ color: "#fca5a5" }}>{error}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex items-center justify-center w-full py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
        style={{ borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5", background: "transparent" }}
      >
        Mark as Inactive
      </button>
      {error && (
        <p className="mt-1.5 text-xs text-center" style={{ color: "#fca5a5" }}>{error}</p>
      )}
    </div>
  );
}
