"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/downloadFile";

interface Props {
  /** Pre-built query string ("" or "status=open&severity=High") carrying the current filters. */
  queryString: string;
}

export function ExportCsvButton({ queryString }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const failure = await downloadFile(
      `/api/export/findings${queryString ? `?${queryString}` : ""}`,
      `findings-${dateStamp}.csv`
    );
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <span className="inline-flex items-center gap-2 flex-shrink-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0"
        style={{
          border: "1px solid #1e293b",
          color: "#94a3b8",
          background: "transparent",
          cursor: "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        ⬇ {busy ? "Preparing…" : "Export CSV"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: "11px", color: "#ef4444" }}>
          {error}
        </span>
      )}
    </span>
  );
}
