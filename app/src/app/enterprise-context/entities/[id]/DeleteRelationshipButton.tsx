"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEnterpriseRelationship } from "@/lib/api";
import { enterpriseContextErrorMessage } from "@/lib/enterpriseContext";

export function DeleteRelationshipButton({ relationshipId }: { relationshipId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteEnterpriseRelationship(relationshipId);
      if (!result.ok) {
        setError(enterpriseContextErrorMessage(result.error));
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="ml-auto flex items-center gap-2 flex-shrink-0">
      {error && <span className="text-xs" style={{ color: "#fca5a5" }}>{error}</span>}
      {confirming ? (
        <>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="px-2 py-1 rounded text-xs font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
            style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.4)" }}
          >
            {isPending ? "Removing…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ color: "#64748b", border: "1px solid #1e293b", background: "transparent" }}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={isPending}
          aria-label="Remove relationship"
          className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
          style={{ color: "#64748b", border: "1px solid #1e293b", background: "transparent" }}
        >
          Remove
        </button>
      )}
    </span>
  );
}
