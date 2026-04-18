"use client";

import { useState, useTransition } from "react";
import { deleteSsoConfigAction } from "./actions";

export function DeleteSsoButton() {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming]  = useState(false);
  const [error, setError]            = useState<string | null>(null);

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "13px", color: "#94a3b8" }}>Delete SSO config?</span>
        <button
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await deleteSsoConfigAction();
              if (result?.error) {
                setError(result.error);
                setConfirming(false);
              }
            });
          }}
          disabled={isPending}
          style={{
            padding: "8px 14px",
            background: "rgba(220,38,38,0.15)",
            border: "1px solid rgba(220,38,38,0.4)",
            borderRadius: "8px",
            color: "#fca5a5",
            fontSize: "13px",
            fontWeight: 600,
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "Deleting…" : "Confirm Delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          style={{
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid #1e2d45",
            borderRadius: "8px",
            color: "#64748b",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        {error && <span style={{ fontSize: "12px", color: "#fca5a5" }}>{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        padding: "9px 18px",
        background: "transparent",
        border: "1px solid rgba(220,38,38,0.4)",
        borderRadius: "8px",
        color: "#fca5a5",
        fontSize: "13px",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Delete SSO Config
    </button>
  );
}
