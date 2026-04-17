"use client";

import { useState, useTransition } from "react";
import { transitionObligationAssessment, type TransitionObligationAssessmentResult } from "./assess/actions";
import type { ObligationAssessment } from "@/lib/api";

type AssessmentStatus = "not_started" | "in_progress" | "compliant" | "non_compliant" | "partially_compliant";

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  not_started:         { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  in_progress:         { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  compliant:           { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  non_compliant:       { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  partially_compliant: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
};

const STATUS_LABELS: Record<string, string> = {
  not_started:         "Not Started",
  in_progress:         "In Progress",
  compliant:           "Compliant",
  non_compliant:       "Non-Compliant",
  partially_compliant: "Partially Compliant",
};

// Terminal statuses — no further transitions
const TERMINAL_STATUSES = new Set(["compliant", "non_compliant", "partially_compliant"]);

const STATUS_TRANSITIONS: Record<string, Array<{ value: string; label: string }>> = {
  not_started: [{ value: "in_progress", label: "Start Review" }],
  in_progress: [
    { value: "compliant", label: "Compliant" },
    { value: "non_compliant", label: "Non-Compliant" },
    { value: "partially_compliant", label: "Partially Compliant" },
  ],
};

const SEVERITY_OPTIONS = ["Critical", "High", "Moderate", "Low"] as const;

type Props = {
  assessment: ObligationAssessment;
  obligationId: string;
};

export function AssessmentStatusCard({ assessment, obligationId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState<AssessmentStatus>(assessment.status);
  const [selectedSeverity, setSelectedSeverity] = useState(assessment.overall_severity ?? "Moderate");
  const [error, setError] = useState<string | null>(null);

  const statusStyle = STATUS_STYLES[optimisticStatus] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const transitions = TERMINAL_STATUSES.has(optimisticStatus) ? [] : (STATUS_TRANSITIONS[optimisticStatus] ?? []);
  const isTerminal = TERMINAL_STATUSES.has(optimisticStatus);

  function handleTransition(newStatus: string) {
    const previous = optimisticStatus;
    setOptimisticStatus(newStatus as AssessmentStatus);
    setError(null);
    startTransition(async () => {
      const result = (await transitionObligationAssessment(
        assessment.id,
        newStatus,
        selectedSeverity,
        obligationId
      )) as TransitionObligationAssessmentResult | void;
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
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#94a3b8" }}>
        Latest Assessment
      </p>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
          style={statusStyle}
        >
          {STATUS_LABELS[optimisticStatus] ?? optimisticStatus}
        </span>
        {assessment.overall_severity && (
          <span className="text-xs" style={{ color: "#64748b" }}>
            {assessment.overall_severity}
          </span>
        )}
      </div>

      {isTerminal && (
        <p className="text-xs mb-2" style={{ color: "#475569" }}>
          Terminal — no further transitions.
        </p>
      )}

      {!isTerminal && transitions.some((t) => ["non_compliant", "partially_compliant"].includes(t.value)) && (
        <div className="mb-3">
          <label className="block text-xs mb-1" style={{ color: "#64748b" }}>Severity for finding</label>
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="text-xs rounded px-2 py-1"
            style={{ background: "#0a0f1a", border: "1px solid #1e293b", color: "#f1f5f9" }}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>{error}</p>
      )}

      {transitions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {transitions.map((t) => (
            <button
              key={t.value}
              onClick={() => handleTransition(t.value)}
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
