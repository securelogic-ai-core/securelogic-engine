"use client";

import { useState, useTransition } from "react";
import { createObligationEvidence, type CreateObligationEvidenceResult } from "./actions";
import type { ObligationAssessment } from "@/lib/api";

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

const EVIDENCE_TYPES = [
  { value: "document", label: "Document" },
  { value: "screenshot", label: "Screenshot" },
  { value: "log", label: "Log" },
  { value: "test_result", label: "Test Result" },
  { value: "interview", label: "Interview" },
  { value: "observation", label: "Observation" },
  { value: "policy", label: "Policy" },
  { value: "other", label: "Other" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  compliant: "Compliant",
  non_compliant: "Non-Compliant",
  partially_compliant: "Partially Compliant",
};

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Props = {
  obligationId: string;
  obligationTitle: string;
  assessments: ObligationAssessment[];
};

export function EvidenceForm({ obligationId, obligationTitle, assessments }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = (await createObligationEvidence(obligationId, formData)) as CreateObligationEvidenceResult | void;
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  if (assessments.length === 0) {
    return (
      <div
        className="rounded-xl border p-6 text-center"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
          No assessments found for this obligation. Evidence must be linked to an assessment.
        </p>
        <a
          href={`/obligations/${obligationId}/assess`}
          className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          Create Assessment First
        </a>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      <div
        className="rounded-xl border p-6 space-y-5"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Evidence Details — {obligationTitle}
        </h2>

        {/* Assessment */}
        <div>
          <label style={LABEL_STYLE}>Link to Assessment *</label>
          <select name="source_id" required style={INPUT_STYLE}>
            <option value="">Select assessment…</option>
            {assessments.map((a) => (
              <option key={a.id} value={a.id}>
                {STATUS_LABELS[a.status] ?? a.status} — {fmt(a.performed_at ?? a.created_at)}
                {a.overall_severity ? ` (${a.overall_severity})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div>
          <label style={LABEL_STYLE}>Title *</label>
          <input
            type="text"
            name="title"
            required
            placeholder="e.g. GDPR compliance review, Privacy policy audit…"
            style={INPUT_STYLE}
          />
        </div>

        {/* Evidence Type */}
        <div>
          <label style={LABEL_STYLE}>Evidence Type *</label>
          <select name="evidence_type" required style={INPUT_STYLE}>
            <option value="">Select type…</option>
            {EVIDENCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label style={LABEL_STYLE}>Description</label>
          <textarea
            name="description"
            rows={3}
            placeholder="Brief description of what this evidence demonstrates…"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </div>

        {/* Collected At */}
        <div>
          <label style={LABEL_STYLE}>Collected At</label>
          <input
            type="date"
            name="collected_at"
            defaultValue={new Date().toISOString().split("T")[0]}
            style={INPUT_STYLE}
          />
        </div>

        {/* Collected By */}
        <div>
          <label style={LABEL_STYLE}>Collected By</label>
          <input
            type="text"
            name="collected_by"
            placeholder="Name or team responsible for collection…"
            style={INPUT_STYLE}
          />
        </div>

        {/* External Ref */}
        <div>
          <label style={LABEL_STYLE}>External Reference</label>
          <input
            type="text"
            name="external_ref"
            placeholder="Ticket ID, document URL, or reference number…"
            style={INPUT_STYLE}
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
          {isPending ? "Saving…" : "Add Evidence"}
        </button>
        <a
          href={`/obligations/${obligationId}`}
          className="px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{ color: "#94a3b8" }}
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
