"use client";

import { useState, useTransition } from "react";
import { updateFindingStatus } from "@/app/actions/updateFindingStatus";
import type { Finding } from "@/lib/api";

const SEVERITY_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",  color: "#86efac" },
};

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)", color: "#fca5a5" },
  in_progress: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  closed:      { background: "rgba(34,197,94,0.12)", color: "#86efac" },
};

const STATUS_TRANSITIONS: Record<string, Array<{ value: "open" | "in_progress" | "closed"; label: string }>> = {
  open:        [{ value: "in_progress", label: "Mark In Progress" }, { value: "closed", label: "Close" }],
  in_progress: [{ value: "closed", label: "Close" }, { value: "open", label: "Reopen" }],
  closed:      [{ value: "open", label: "Reopen" }],
};

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Props = {
  finding: Finding;
  revalidateUrl: string;
};

export function FindingCard({ finding, revalidateUrl }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState(finding.status);
  const [error, setError] = useState<string | null>(null);

  const severityStyle = SEVERITY_STYLES[finding.severity ?? ""] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const statusStyle = STATUS_STYLES[optimisticStatus] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const transitions = STATUS_TRANSITIONS[optimisticStatus] ?? [];

  function handleStatusChange(status: "open" | "in_progress" | "closed") {
    const previous = optimisticStatus;
    setOptimisticStatus(status);
    setError(null);
    startTransition(async () => {
      const result = await updateFindingStatus(finding.id, status, revalidateUrl);
      if (result && "error" in result) {
        setOptimisticStatus(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {finding.severity && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={severityStyle}>
              {finding.severity}
            </span>
          )}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={statusStyle}
          >
            {optimisticStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        </div>
        <span className="text-xs shrink-0" style={{ color: "#64748b" }}>
          {fmt(finding.created_at)}
        </span>
      </div>

      <p className="text-sm font-medium mb-1" style={{ color: "#f1f5f9" }}>
        {finding.title}
      </p>

      {finding.description && (
        <p className="text-xs mb-3" style={{ color: "#94a3b8" }}>
          {finding.description}
        </p>
      )}

      {error && (
        <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}

      {transitions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={() => handleStatusChange(t.value)}
              disabled={isPending}
              className="px-3 py-1 rounded text-xs font-medium transition-opacity disabled:opacity-50"
              style={{ background: "rgba(148,163,184,0.08)", color: "#94a3b8", border: "1px solid #1e293b" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
