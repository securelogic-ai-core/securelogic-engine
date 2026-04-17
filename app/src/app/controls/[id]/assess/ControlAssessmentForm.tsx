"use client";

import { useState, useTransition } from "react";
import { createControlAssessment, type CreateControlAssessmentResult } from "./actions";
import type { ComplianceContext } from "@/lib/api";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #1e293b",
  background: "#0a0f1a",
  color: "#f1f5f9",
  fontSize: "14px",
  outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "#94a3b8",
  marginBottom: "6px",
};

const SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;
const STATUSES = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "remediation_required", label: "Remediation Required" },
] as const;

const SEVERITY_COLOR: Record<string, string> = {
  Critical: "#fca5a5",
  High: "#fdba74",
  Moderate: "#fcd34d",
  Low: "#86efac",
};

type Props = {
  controlId: string;
  controlName: string;
  complianceContext: ComplianceContext | null;
};

export function ControlAssessmentForm({ controlId, controlName, complianceContext }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = (await createControlAssessment(controlId, formData)) as CreateControlAssessmentResult | void;
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Context card */}
      {complianceContext && (
        <div
          className="rounded-xl border p-5"
          style={{ background: "rgba(0,196,180,0.04)", borderColor: "rgba(0,196,180,0.15)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#00c4b4" }}>
              AI Assessment Context
            </span>
            {complianceContext.suggestedSeverity && (
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{
                  color: SEVERITY_COLOR[complianceContext.suggestedSeverity] ?? "#94a3b8",
                  background: "rgba(148,163,184,0.1)",
                }}
              >
                Suggested: {complianceContext.suggestedSeverity}
              </span>
            )}
          </div>
          {complianceContext.suggestedSummary && (
            <p className="text-sm mb-3" style={{ color: "#cbd5e1" }}>
              {complianceContext.suggestedSummary}
            </p>
          )}
          {complianceContext.riskIndicators.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold mb-1" style={{ color: "#fcd34d" }}>Risk Indicators</p>
              <ul className="space-y-0.5">
                {complianceContext.riskIndicators.map((r, i) => (
                  <li key={i} className="text-xs" style={{ color: "#94a3b8" }}>• {r}</li>
                ))}
              </ul>
            </div>
          )}
          {complianceContext.assessmentGuidance && (
            <p className="text-xs" style={{ color: "#64748b" }}>
              {complianceContext.assessmentGuidance}
            </p>
          )}
        </div>
      )}

      <form action={handleSubmit} className="space-y-6">
        <div
          className="rounded-xl border p-6 space-y-5"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            Assessment Details — {controlName}
          </h2>

          {/* Status */}
          <div>
            <label style={LABEL_STYLE}>Status *</label>
            <select name="status" required style={INPUT_STYLE}>
              <option value="">Select status…</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Overall Severity */}
          <div>
            <label style={LABEL_STYLE}>Overall Severity *</label>
            <select
              name="overall_severity"
              required
              defaultValue={complianceContext?.suggestedSeverity ?? ""}
              style={INPUT_STYLE}
            >
              <option value="">Select severity…</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Performed At */}
          <div>
            <label style={LABEL_STYLE}>Performed At</label>
            <input
              type="date"
              name="performed_at"
              defaultValue={new Date().toISOString().split("T")[0]}
              style={INPUT_STYLE}
            />
          </div>

          {/* Summary */}
          <div>
            <label style={LABEL_STYLE}>Summary</label>
            <textarea
              name="summary"
              rows={3}
              placeholder={complianceContext?.suggestedSummary ? `e.g. ${complianceContext.suggestedSummary}` : "Brief summary of this assessment…"}
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={LABEL_STYLE}>Notes</label>
            <textarea
              name="notes"
              rows={4}
              placeholder="Detailed notes, evidence references, observations…"
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>
        </div>

        {error && (
          <p
            className="text-sm px-4 py-3 rounded-lg"
            style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {isPending ? "Saving…" : "Create Assessment"}
          </button>
          <a
            href={`/controls/${controlId}`}
            className="px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ color: "#94a3b8" }}
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
