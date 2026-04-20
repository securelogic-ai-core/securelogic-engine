"use client";

import { useState, useTransition } from "react";
import { createAssessment, type CreateAssessmentResult } from "./actions";

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
const ASSESSMENT_TYPES = [
  "Annual Review",
  "Onboarding",
  "Triggered Review",
  "Continuous Monitoring",
  "Contract Renewal",
  "Incident Response",
  "Custom",
] as const;

type Props = {
  vendorId: string;
  vendorName: string;
};

export function AssessmentForm({ vendorId, vendorName }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [importedFindings, setImportedFindings] = useState<
    Array<{ title: string; severity: string; description: string; recommendation: string }>
  >([]);
  const [docAnalysis, setDocAnalysis] = useState<{
    documentType: string;
    overallRiskSummary: string;
    suggestedAssessmentSeverity: string | null;
    findings: Array<{ title: string; severity: string; description: string; recommendation: string }>;
    keyStrengths: string[];
    keyGaps: string[];
  } | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  async function handleDocUpload() {
    if (!docFile) return;
    setDocUploading(true);
    setDocError(null);
    setDocAnalysis(null);
    try {
      const formData = new FormData();
      formData.append("document", docFile);
      formData.append("vendor_name", vendorName);
      const res = await fetch("/api/vendor-assessments/analyze-document", {
        method: "POST",
        body: formData,
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
    if (importedFindings.length > 0) {
      formData.set("imported_findings_json", JSON.stringify(importedFindings));
    }
    startTransition(async () => {
      const result = (await createAssessment(vendorId, formData)) as CreateAssessmentResult | void;
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  function importFinding(f: { title: string; severity: string; description: string; recommendation: string }) {
    setImportedFindings((prev) => {
      const alreadyImported = prev.some((p) => p.title === f.title && p.severity === f.severity);
      if (alreadyImported) return prev;
      return [...prev, f];
    });
  }

  function removeFinding(index: number) {
    setImportedFindings((prev) => prev.filter((_, i) => i !== index));
  }

  const severityColor: Record<string, string> = {
    Critical: "#fca5a5",
    High: "#fdba74",
    Moderate: "#fcd34d",
    Low: "#86efac",
    Informational: "#93c5fd",
  };

  return (
    <form action={handleSubmit} className="space-y-6">
      <div
        className="rounded-xl border p-6 space-y-5"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Assessment Details
        </h2>

        {/* Assessment Type */}
        <div>
          <label style={LABEL_STYLE}>Assessment Type *</label>
          <select name="assessment_type" required style={INPUT_STYLE}>
            <option value="">Select type…</option>
            {ASSESSMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Overall Severity */}
        <div>
          <label style={LABEL_STYLE}>Overall Severity *</label>
          <select
            name="overall_severity"
            required
            defaultValue={docAnalysis?.suggestedAssessmentSeverity ?? ""}
            style={INPUT_STYLE}
          >
            <option value="">Select severity…</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
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
            placeholder="Brief summary of this assessment…"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </div>

        {/* Notes */}
        <div>
          <label style={LABEL_STYLE}>Notes</label>
          <textarea
            name="notes"
            rows={4}
            placeholder="Detailed notes, observations, evidence references…"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </div>
      </div>

      {/* Document Upload Section */}
      <div
        className="rounded-xl border p-6 space-y-4"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-1" style={{ color: "#94a3b8" }}>
            Document Analysis (Optional)
          </h2>
          <p className="text-xs" style={{ color: "#64748b" }}>
            Upload a SOC 2 report, pentest report, audit, or policy document for AI-powered finding extraction.
            Files are analyzed and immediately discarded — never stored.
          </p>
        </div>

        <div className="flex items-center gap-3">
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
          <p className="text-xs" style={{ color: "#fca5a5" }}>
            {docError}
          </p>
        )}

        {docAnalysis && (
          <div className="space-y-4 mt-2">
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
                    style={{ color: severityColor[docAnalysis.suggestedAssessmentSeverity] ?? "#94a3b8", background: "rgba(148,163,184,0.1)" }}
                  >
                    Suggested: {docAnalysis.suggestedAssessmentSeverity}
                  </span>
                )}
              </div>
              <p className="text-sm mb-3" style={{ color: "#cbd5e1" }}>
                {docAnalysis.overallRiskSummary}
              </p>

              {docAnalysis.keyStrengths.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold mb-1" style={{ color: "#86efac" }}>Strengths</p>
                  <ul className="space-y-0.5">
                    {docAnalysis.keyStrengths.map((s, i) => (
                      <li key={i} className="text-xs" style={{ color: "#94a3b8" }}>• {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {docAnalysis.keyGaps.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: "#fcd34d" }}>Gaps</p>
                  <ul className="space-y-0.5">
                    {docAnalysis.keyGaps.map((g, i) => (
                      <li key={i} className="text-xs" style={{ color: "#94a3b8" }}>• {g}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {docAnalysis.findings.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  Extracted Findings ({docAnalysis.findings.length})
                </p>
                <div className="space-y-2">
                  {docAnalysis.findings.map((f, i) => {
                    const alreadyImported = importedFindings.some(
                      (p) => p.title === f.title && p.severity === f.severity
                    );
                    return (
                      <div
                        key={i}
                        className="rounded-lg border p-3"
                        style={{ background: "rgba(10,15,26,0.6)", borderColor: "#1e293b" }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="text-xs font-semibold flex-shrink-0"
                              style={{ color: severityColor[f.severity] ?? "#94a3b8" }}
                            >
                              {f.severity}
                            </span>
                            <span className="text-xs font-medium truncate" style={{ color: "#f1f5f9" }}>
                              {f.title}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => importFinding(f)}
                            disabled={alreadyImported}
                            className="px-2 py-1 rounded text-xs font-semibold flex-shrink-0 transition-opacity disabled:opacity-40"
                            style={{
                              background: alreadyImported ? "rgba(34,197,94,0.1)" : "rgba(0,196,180,0.15)",
                              color: alreadyImported ? "#86efac" : "#00c4b4",
                            }}
                          >
                            {alreadyImported ? "Imported" : "Import"}
                          </button>
                        </div>
                        <p className="text-xs mb-1" style={{ color: "#94a3b8" }}>
                          {f.description}
                        </p>
                        <p className="text-xs" style={{ color: "#64748b" }}>
                          → {f.recommendation}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {importedFindings.length > 0 && (
              <div
                className="rounded-lg border p-3 space-y-2"
                style={{ background: "rgba(0,196,180,0.04)", borderColor: "rgba(0,196,180,0.2)" }}
              >
                <p className="text-xs font-semibold" style={{ color: "#00c4b4" }}>
                  Imported ({importedFindings.length}) — will be created with assessment
                </p>
                {importedFindings.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs truncate" style={{ color: "#94a3b8" }}>
                      <span style={{ color: severityColor[f.severity] ?? "#94a3b8" }}>{f.severity}</span>
                      {" · "}
                      {f.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFinding(i)}
                      className="text-xs flex-shrink-0 hover:opacity-80 transition-opacity"
                      style={{ color: "#475569" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm px-4 py-3 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5" }}>
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
          href={`/vendors/${vendorId}`}
          className="px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{ color: "#94a3b8" }}
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
