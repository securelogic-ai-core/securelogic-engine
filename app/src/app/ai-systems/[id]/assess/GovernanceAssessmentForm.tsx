"use client";

import { useState, useTransition } from "react";
import { createGovernanceAssessment, type CreateGovernanceAssessmentResult } from "./actions";
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

type StatusOption = {
  value: string;
  label: string;
  color: string;
  activeBg: string;
  bg: string;
  createsF: boolean;
};

const STATUSES: StatusOption[] = [
  { value: "not_started",         label: "Not Started",         color: "#94a3b8", bg: "rgba(148,163,184,0.08)", activeBg: "rgba(148,163,184,0.2)", createsF: false },
  { value: "in_progress",         label: "In Progress",         color: "#93c5fd", bg: "rgba(59,130,246,0.08)",  activeBg: "rgba(59,130,246,0.2)",  createsF: false },
  { value: "compliant",           label: "Compliant",           color: "#86efac", bg: "rgba(34,197,94,0.08)",   activeBg: "rgba(34,197,94,0.2)",   createsF: false },
  { value: "non_compliant",       label: "Non-Compliant",       color: "#fca5a5", bg: "rgba(239,68,68,0.08)",   activeBg: "rgba(239,68,68,0.2)",   createsF: true },
  { value: "partially_compliant", label: "Partially Compliant", color: "#fcd34d", bg: "rgba(245,158,11,0.08)",  activeBg: "rgba(245,158,11,0.2)",  createsF: true },
];

const SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;

const SEVERITY_COLORS: Record<string, { bg: string; color: string; activeBg: string }> = {
  Critical: { bg: "rgba(239,68,68,0.08)", color: "#fca5a5", activeBg: "rgba(239,68,68,0.25)" },
  High:     { bg: "rgba(249,115,22,0.08)", color: "#fdba74", activeBg: "rgba(249,115,22,0.25)" },
  Moderate: { bg: "rgba(245,158,11,0.08)", color: "#fcd34d", activeBg: "rgba(245,158,11,0.25)" },
  Low:      { bg: "rgba(34,197,94,0.08)",  color: "#86efac", activeBg: "rgba(34,197,94,0.25)" },
};

const SEVERITY_LABEL_COLOR: Record<string, string> = {
  Critical: "#fca5a5",
  High: "#fdba74",
  Moderate: "#fcd34d",
  Low: "#86efac",
};

type Props = {
  systemId: string;
  systemName: string;
  governanceContext: ComplianceContext | null;
};

export function GovernanceAssessmentForm({ systemId, systemName, governanceContext }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>("not_started");
  const [selectedSeverity, setSelectedSeverity] = useState<string>(governanceContext?.suggestedSeverity ?? "");

  // Document upload state
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docAnalysis, setDocAnalysis] = useState<{
    documentType: string;
    overallRiskSummary: string;
    suggestedAssessmentSeverity: string | null;
  } | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docExpanded, setDocExpanded] = useState(false);

  const currentStatus = STATUSES.find((s) => s.value === selectedStatus);
  const needsSeverity = currentStatus?.createsF ?? false;

  async function handleDocUpload() {
    if (!docFile) return;
    setDocUploading(true);
    setDocError(null);
    setDocAnalysis(null);
    try {
      const fd = new FormData();
      fd.append("document", docFile);
      fd.append("vendor_name", systemName);
      const res = await fetch("/api/vendor-assessments/analyze-document", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDocError(body.error ?? "Analysis failed");
        return;
      }
      const body = (await res.json()) as { analysis: typeof docAnalysis };
      setDocAnalysis(body.analysis);
    } catch {
      setDocError("Network error — please try again");
    } finally {
      setDocUploading(false);
    }
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = (await createGovernanceAssessment(systemId, formData)) as CreateGovernanceAssessmentResult | void;
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* AI Governance Context card */}
      {governanceContext && (
        <div
          className="rounded-xl border p-5"
          style={{ background: "rgba(59,130,246,0.08)", borderColor: "rgba(59,130,246,0.3)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#93c5fd" }}>
              📋 AI Governance Guidance
            </span>
            {governanceContext.suggestedSeverity && (
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{
                  color: SEVERITY_LABEL_COLOR[governanceContext.suggestedSeverity] ?? "#94a3b8",
                  background: "rgba(148,163,184,0.1)",
                }}
              >
                Suggested: {governanceContext.suggestedSeverity}
              </span>
            )}
          </div>
          {governanceContext.suggestedSummary && (
            <p className="text-sm mb-3" style={{ color: "#cbd5e1" }}>
              {governanceContext.suggestedSummary}
            </p>
          )}
          {governanceContext.riskIndicators.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold mb-1" style={{ color: "#fcd34d" }}>Risk Indicators</p>
              <ul className="space-y-0.5">
                {governanceContext.riskIndicators.map((r, i) => (
                  <li key={i} className="text-xs" style={{ color: "#94a3b8" }}>• {r}</li>
                ))}
              </ul>
            </div>
          )}
          {governanceContext.assessmentGuidance && (
            <p className="text-xs" style={{ color: "#64748b" }}>
              {governanceContext.assessmentGuidance}
            </p>
          )}
        </div>
      )}

      <form action={handleSubmit} className="space-y-6">
        {/* Hidden inputs for button group values */}
        <input type="hidden" name="status" value={selectedStatus} />
        <input type="hidden" name="overall_severity" value={selectedSeverity} />

        <div
          className="rounded-xl border p-6 space-y-5"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            Assessment Outcome — {systemName}
          </h2>

          {/* Status button group */}
          <div>
            <label style={LABEL_STYLE}>Status *</label>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => {
                const isActive = selectedStatus === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSelectedStatus(s.value)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: isActive ? s.activeBg : s.bg,
                      color: s.color,
                      border: `1px solid ${isActive ? s.color : "transparent"}`,
                    }}
                  >
                    {s.label}
                    {s.createsF && " ⚠"}
                  </button>
                );
              })}
            </div>
            {currentStatus && (
              <p className="text-xs mt-2" style={{ color: currentStatus.createsF ? "#fcd34d" : "#475569" }}>
                {currentStatus.createsF
                  ? "⚠ Selecting this status will automatically create a finding."
                  : selectedStatus === "compliant"
                  ? "✓ No finding will be created."
                  : null}
              </p>
            )}
          </div>

          {/* Severity button group — shown when finding-triggering */}
          {needsSeverity && (
            <div>
              <label style={LABEL_STYLE}>Overall Severity *</label>
              <div className="flex items-center gap-2 flex-wrap">
                {SEVERITIES.map((s) => {
                  const colors = SEVERITY_COLORS[s]!;
                  const isActive = selectedSeverity === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelectedSeverity(s)}
                      className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                      style={{
                        background: isActive ? colors.activeBg : colors.bg,
                        color: colors.color,
                        border: `1px solid ${isActive ? colors.color : "transparent"}`,
                        opacity: isActive ? 1 : 0.7,
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary */}
          <div>
            <label style={LABEL_STYLE}>
              Summary{needsSeverity ? " *" : ""}
            </label>
            <textarea
              name="summary"
              rows={6}
              defaultValue={governanceContext?.suggestedSummary ?? ""}
              placeholder={
                governanceContext?.suggestedSummary
                  ? `e.g. ${governanceContext.suggestedSummary}`
                  : "Describe the governance assessment findings and overall conclusions…"
              }
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={LABEL_STYLE}>Notes</label>
            <textarea
              name="notes"
              rows={4}
              placeholder="Detailed notes, evidence references, regulatory observations…"
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
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
        </div>

        {/* Document Upload (collapsible) */}
        <div
          className="rounded-xl border"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <button
            type="button"
            onClick={() => setDocExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-6 py-4 text-left"
          >
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
                Document Analysis (Optional)
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                Upload an AI governance document for AI analysis
              </p>
            </div>
            <span className="text-xs" style={{ color: "#475569" }}>
              {docExpanded ? "▲" : "▼"}
            </span>
          </button>

          {docExpanded && (
            <div className="px-6 pb-6 space-y-4 border-t" style={{ borderColor: "#1e293b" }}>
              <div className="flex items-center gap-3 pt-4">
                <input
                  type="file"
                  accept=".pdf,.txt,.csv"
                  onChange={(e) => {
                    setDocFile(e.target.files?.[0] ?? null);
                    setDocAnalysis(null);
                    setDocError(null);
                  }}
                  style={{ fontSize: "13px", color: "#94a3b8" }}
                />
                {docFile && (
                  <button
                    type="button"
                    onClick={handleDocUpload}
                    disabled={docUploading}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4" }}
                  >
                    {docUploading ? "Analyzing…" : "Analyze"}
                  </button>
                )}
              </div>

              {docError && (
                <p className="text-xs" style={{ color: "#fca5a5" }}>{docError}</p>
              )}

              {docAnalysis && (
                <div
                  className="rounded-lg border p-4"
                  style={{ background: "rgba(0,196,180,0.04)", borderColor: "rgba(0,196,180,0.15)" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#00c4b4" }}>
                      {docAnalysis.documentType}
                    </span>
                    {docAnalysis.suggestedAssessmentSeverity && (
                      <span
                        className="text-xs px-2 py-0.5 rounded font-semibold"
                        style={{
                          color: SEVERITY_LABEL_COLOR[docAnalysis.suggestedAssessmentSeverity] ?? "#94a3b8",
                          background: "rgba(148,163,184,0.1)",
                        }}
                      >
                        Suggested: {docAnalysis.suggestedAssessmentSeverity}
                      </span>
                    )}
                  </div>
                  <p className="text-sm" style={{ color: "#cbd5e1" }}>
                    {docAnalysis.overallRiskSummary}
                  </p>
                </div>
              )}
            </div>
          )}
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
            {isPending ? "Saving…" : "Save Assessment"}
          </button>
          <a
            href={`/ai-systems/${systemId}`}
            className="px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ color: "#94a3b8" }}
          >
            ← Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
