"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/downloadFile";

interface Props {
  frameworkId: string;
  frameworkName: string;
}

const baseButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "8px 16px",
  borderRadius: "8px",
  fontSize: "13px",
  cursor: "pointer",
};

export function DownloadButtons({ frameworkId, frameworkName }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function handleDownload(key: string, url: string, fallbackName: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    const failure = await downloadFile(url, fallbackName);
    setBusy(null);
    if (failure) setError(failure);
  }

  const dateStamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Gap Report — primary download */}
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <button
            type="button"
            onClick={() =>
              handleDownload(
                "gap-report",
                `/api/export/gap-report/${frameworkId}`,
                `gap-report-${dateStamp}.pdf`
              )
            }
            disabled={busy !== null}
            style={{
              ...baseButtonStyle,
              fontWeight: 600,
              background: "#00c4b4",
              color: "#fff",
              border: "none",
              opacity: busy === "gap-report" ? 0.7 : 1,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#009e91"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#00c4b4"; }}
          >
            &#8595; {busy === "gap-report" ? "Preparing…" : "Gap Report (PDF)"}
          </button>
          <span style={{ fontSize: "11px", color: "#64748b", paddingLeft: "2px" }}>
            Management summary of {frameworkName} gaps and remediation priorities
          </span>
        </div>

        {/* Audit Package — secondary */}
        <button
          type="button"
          onClick={() =>
            handleDownload(
              "audit-package",
              `/api/export/audit-package/${frameworkId}`,
              `audit-package-${dateStamp}.pdf`
            )
          }
          disabled={busy !== null}
          style={{
            ...baseButtonStyle,
            fontWeight: 500,
            border: "1px solid #00c4b4",
            color: "#00c4b4",
            background: "transparent",
            opacity: busy === "audit-package" ? 0.7 : 1,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,196,180,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          &#8595; {busy === "audit-package" ? "Preparing…" : "Audit Package (PDF)"}
        </button>

        <button
          type="button"
          onClick={() =>
            handleDownload(
              "findings-csv",
              "/api/export/findings",
              `findings-${dateStamp}.csv`
            )
          }
          disabled={busy !== null}
          style={{
            ...baseButtonStyle,
            fontWeight: 500,
            border: "1px solid #1e293b",
            color: "#94a3b8",
            background: "transparent",
            opacity: busy === "findings-csv" ? 0.7 : 1,
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#475569";
            e.currentTarget.style.color = "#cbd5e1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#1e293b";
            e.currentTarget.style.color = "#94a3b8";
          }}
        >
          ⬇ {busy === "findings-csv" ? "Preparing…" : "Export Findings (CSV)"}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: "12px", color: "#ef4444", margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
