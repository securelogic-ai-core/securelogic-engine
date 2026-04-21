"use client";

import { useState } from "react";

function formatLoginDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function isOlderThan30Days(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > 30 * 24 * 60 * 60 * 1000;
}

export function LastLoginBanner({ previousLoginAt }: { previousLoginAt: string | null }) {
  const [dismissed, setDismissed] = useState(false);

  if (!previousLoginAt || dismissed) return null;

  const stale = isOlderThan30Days(previousLoginAt);

  return (
    <div
      className="mb-6 flex items-center justify-between gap-4 rounded-xl px-5 py-3"
      style={{
        background: stale ? "rgba(239,68,68,0.08)" : "rgba(148,163,184,0.06)",
        border: stale ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(148,163,184,0.15)",
      }}
    >
      <p className="text-xs" style={{ color: stale ? "#fca5a5" : "#64748b" }}>
        {stale ? (
          <>
            <span style={{ fontWeight: 600 }}>Security notice:</span>{" "}
          </>
        ) : null}
        Last signed in {formatLoginDate(previousLoginAt)}
      </p>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: stale ? "#fca5a5" : "#64748b",
          padding: "0 2px",
          lineHeight: 1,
          fontSize: "16px",
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
