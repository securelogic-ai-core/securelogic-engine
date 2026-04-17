"use client";

import { useState, useTransition } from "react";
import { updateControlAssessmentStatus, type UpdateControlAssessmentStatusResult } from "./assess/actions";
import type { ControlAssessment } from "@/lib/api";

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  not_started:          { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  in_progress:          { background: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  passed:               { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  failed:               { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  remediation_required: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
};

const STATUS_LABELS: Record<string, string> = {
  not_started:          "Not Started",
  in_progress:          "In Progress",
  passed:               "Passed",
  failed:               "Failed",
  remediation_required: "Remediation Required",
};

const STATUS_TRANSITIONS: Record<string, Array<{ value: string; label: string }>> = {
  not_started:          [{ value: "in_progress", label: "Start" }],
  in_progress:          [{ value: "passed", label: "Pass" }, { value: "failed", label: "Fail" }, { value: "remediation_required", label: "Remediation Required" }],
  passed:               [{ value: "in_progress", label: "Re-test" }],
  failed:               [{ value: "in_progress", label: "Re-open" }, { value: "remediation_required", label: "Remediation Required" }],
  remediation_required: [{ value: "in_progress", label: "Re-open" }, { value: "passed", label: "Mark Passed" }],
};

const SEVERITY_OPTIONS = ["Critical", "High", "Moderate", "Low"] as const;

type Props = {
  assessment: ControlAssessment;
  controlId: string;
};

export function AssessmentStatusCard({ assessment, controlId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useState(assessment.status);
  const [selectedSeverity, setSelectedSeverity] = useState(assessment.overall_severity ?? "Moderate");
  const [error, setError] = useState<string | null>(null);

  const statusStyle = STATUS_STYLES[optimisticStatus] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const transitions = STATUS_TRANSITIONS[optimisticStatus] ?? [];
  const needsSeverity = optimisticStatus === "in_progress" && transitions.some((t) => ["failed", "remediation_required"].includes(t.value));

  function handleTransition(newStatus: string) {
    const previous = optimisticStatus;
    setOptimisticStatus(newStatus);
    setError(null);
    startTransition(async () => {
      const result = (await updateControlAssessmentStatus(
        assessment.id,
        newStatus,
        selectedSeverity,
        controlId
      )) as UpdateControlAssessmentStatusResult | void;
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

      {needsSeverity && (
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
