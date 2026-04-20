"use client";

import { useState } from "react";
import { deactivateFramework } from "./actions";

interface DeactivateButtonProps {
  frameworkId: string;
  frameworkName: string;
}

export function DeactivateButton({ frameworkId, frameworkName }: DeactivateButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsPending(true);
    setError(null);
    const result = await deactivateFramework(frameworkId);
    if (result && "error" in result) {
      setError(result.error);
      setIsPending(false);
      setShowConfirm(false);
    }
    // On success, deactivateFramework redirects — component unmounts naturally
  }

  if (showConfirm) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.6)" }}
      >
        <div
          className="w-full max-w-sm rounded-xl p-6 border"
          style={{ background: "#0f1623", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <p className="text-sm font-semibold mb-2" style={{ color: "#f1f5f9" }}>
            Remove {frameworkName}?
          </p>
          <p className="text-xs leading-relaxed mb-5" style={{ color: "#94a3b8" }}>
            This will remove all associated requirements and control mappings.
            This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowConfirm(false)}
              disabled={isPending}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              style={{ background: "rgba(239,68,68,0.15)", color: "#fca5a5" }}
            >
              {isPending ? "Removing…" : "Remove"}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-xs" style={{ color: "#fca5a5" }}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium transition-colors hover:opacity-80"
      style={{ background: "rgba(255,255,255,0.04)", color: "#64748b" }}
    >
      Remove
    </button>
  );
}
