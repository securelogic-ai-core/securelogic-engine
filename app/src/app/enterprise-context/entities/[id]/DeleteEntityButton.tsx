"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEnterpriseEntity } from "@/lib/api";
import { enterpriseContextErrorMessage } from "@/lib/enterpriseContext";

export function DeleteEntityButton({
  entityId,
  entityName,
}: {
  entityId: string;
  entityName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteEnterpriseEntity(entityId);
      if (!result.ok) {
        setError(enterpriseContextErrorMessage(result.error));
        setConfirming(false);
        return;
      }
      router.push("/enterprise-context");
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <div
        className="rounded-lg border px-4 py-3 space-y-2"
        style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
      >
        <p className="text-xs" style={{ color: "#fca5a5" }}>
          Delete <strong>{entityName}</strong>? Its relationships will no longer appear
          in the enterprise graph.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="px-3 py-1.5 rounded text-xs font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
            style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.4)" }}
          >
            {isPending ? "Deleting…" : "Confirm Delete"}
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
        {error && <p className="text-xs" style={{ color: "#fca5a5" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
        style={{ borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5", background: "transparent" }}
      >
        Delete Entity
      </button>
      {error && <p className="mt-1.5 text-xs" style={{ color: "#fca5a5" }}>{error}</p>}
    </div>
  );
}
