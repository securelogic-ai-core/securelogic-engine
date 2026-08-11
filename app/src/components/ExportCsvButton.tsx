"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/downloadFile";

interface Props {
  /** App proxy path, e.g. "/api/export/findings" or "/api/export/risks". */
  endpoint: string;
  /** Downloaded file name becomes `${filenamePrefix}-YYYY-MM-DD.csv`. */
  filenamePrefix: string;
  /** Pre-built query string ("" or "status=open&severity=High") carrying the current filters. */
  queryString: string;
}

/**
 * Shared register-export button (findings, risks, …). One component so every
 * export surface behaves identically: same busy state, same error surface,
 * same filter passthrough via queryString.
 */
export function ExportCsvButton({ endpoint, filenamePrefix, queryString }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const failure = await downloadFile(
      `${endpoint}${queryString ? `?${queryString}` : ""}`,
      `${filenamePrefix}-${dateStamp}.csv`
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
