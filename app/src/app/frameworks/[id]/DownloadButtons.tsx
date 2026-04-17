"use client";

interface Props {
  frameworkId: string;
}

export function DownloadButtons({ frameworkId }: Props) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <a
        href={`/api/export/audit-package/${frameworkId}`}
        download
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 16px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: 500,
          border: "1px solid #00c4b4",
          color: "#00c4b4",
          background: "transparent",
          textDecoration: "none",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,196,180,0.08)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        ⬇ Download Audit Package (PDF)
      </a>
      <a
        href="/api/export/findings"
        download
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 16px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: 500,
          border: "1px solid #1e293b",
          color: "#94a3b8",
          background: "transparent",
          textDecoration: "none",
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
        ⬇ Export Findings (CSV)
      </a>
    </div>
  );
}
