"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  accepted:    { background: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
};

const STATUS_TRANSITIONS: Record<string, Array<{ value: "open" | "in_progress" | "closed"; label: string }>> = {
  open:        [{ value: "in_progress", label: "Start" }, { value: "closed", label: "Close" }],
  in_progress: [{ value: "closed", label: "Resolve" }, { value: "open", label: "Reopen" }],
  closed:      [{ value: "open", label: "Reopen" }],
  accepted:    [{ value: "open", label: "Reopen" }],
};

const STATUS_LABELS: Record<string, string> = {
  open:        "Open",
  in_progress: "In Progress",
  closed:      "Closed",
  accepted:    "Accepted",
};

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(dateStr).getTime() - now.getTime()) / 86400000);
}

type Props = {
  finding: Finding;
  revalidateUrl: string;
};

export function FindingCard({ finding, revalidateUrl }: Props) {
  const router = useRouter();
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

  function handleCardClick() {
    router.push(`/findings/${finding.id}`);
  }

  // Due date display
  let dueDateNode: React.ReactNode = null;
  if (finding.due_date) {
    const days = daysUntil(finding.due_date);
    const dueDateStr = fmt(finding.due_date);
    if (days < 0) {
      dueDateNode = <span style={{ color: "#fca5a5" }}>Was due {dueDateStr}</span>;
    } else if (days <= 7) {
      dueDateNode = <span style={{ color: "#fcd34d" }}>Due {dueDateStr}</span>;
    } else {
      dueDateNode = <span style={{ color: "#94a3b8" }}>Due {dueDateStr}</span>;
    }
  }

  return (
    <div
      className="rounded-xl border p-4 cursor-pointer transition-colors"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      onClick={handleCardClick}
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
            {STATUS_LABELS[optimisticStatus] ?? optimisticStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
          {finding.action_count > 0 && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              style={{ background: "rgba(0,196,180,0.1)", color: "#00c4b4" }}
            >
              {finding.action_count} action{finding.action_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="text-xs shrink-0" style={{ color: "#64748b" }}>
          {fmt(finding.created_at)}
        </span>
      </div>

      <p className="text-sm font-medium mb-1" style={{ color: "#f1f5f9" }}>
        {finding.title}
      </p>

      {finding.description && (
        <p className="text-xs mb-2" style={{ color: "#94a3b8" }}>
          {finding.description}
        </p>
      )}

      {finding.recommendation && (
        <p className="text-xs mb-2 line-clamp-1" style={{ color: "#475569" }}>
          → {finding.recommendation}
        </p>
      )}

      {(dueDateNode || finding.domain) && (
        <div className="flex items-center gap-3 text-xs mb-2" style={{ color: "#64748b" }}>
          {dueDateNode}
          {dueDateNode && finding.domain && <span>·</span>}
          {finding.domain && <span>{finding.domain}</span>}
        </div>
      )}

      {error && (
        <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>{error}</p>
      )}

      {transitions.length > 0 && (
        <div
          className="flex items-center gap-2 flex-wrap mt-2"
          onClick={(e) => e.stopPropagation()}
        >
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={(e) => { e.stopPropagation(); handleStatusChange(t.value); }}
              disabled={isPending}
              className="px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
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
