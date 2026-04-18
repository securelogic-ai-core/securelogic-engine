"use client";

import { useState, useTransition } from "react";
import type { Control } from "@/lib/api";
import { linkControlAction } from "./actions";

interface Props {
  policyId: string;
  allControls: Control[];
  linkedControlIds: string[];
}

export function LinkControlSection({ policyId, allControls, linkedControlIds }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedControlId, setSelectedControlId] = useState("");

  const unlinked = allControls.filter((c) => !linkedControlIds.includes(c.id));

  if (allControls.length === 0) {
    return (
      <p className="text-xs" style={{ color: "#475569" }}>
        No controls found. Add controls first.
      </p>
    );
  }

  if (unlinked.length === 0) {
    return (
      <p className="text-xs" style={{ color: "#475569" }}>
        All controls are already linked.
      </p>
    );
  }

  function handleLink() {
    if (!selectedControlId) return;
    setError(null);
    startTransition(async () => {
      const result = await linkControlAction(policyId, selectedControlId);
      if (result.error) {
        setError(result.error);
      } else {
        setSelectedControlId("");
      }
    });
  }

  return (
    <div className="mt-3">
      {error && (
        <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>{error}</p>
      )}
      <div className="flex items-center gap-2">
        <select
          value={selectedControlId}
          onChange={(e) => setSelectedControlId(e.target.value)}
          className="flex-1 text-xs rounded-lg"
          style={{
            background: "rgba(15,23,42,0.6)",
            border: "1px solid #1e2d45",
            color: "#f1f5f9",
            padding: "6px 10px",
          }}
        >
          <option value="">Select a control…</option>
          {unlinked.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={handleLink}
          disabled={isPending || !selectedControlId}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {isPending ? "Linking…" : "Link Control"}
        </button>
      </div>
    </div>
  );
}
